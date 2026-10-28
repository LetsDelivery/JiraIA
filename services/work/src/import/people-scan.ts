import { NotFoundException } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

import type { AtlassianSource } from './atlassian-source.js'
import { versionKey } from './confluence-raw-copy.js'
import type { ImportStore } from './import-store.js'
import { inPool, manifestSchema } from './jira-raw-copy.js'
import { type Account, collectAccounts, type Person, parseDirectory, proposePeople } from './people.js'

type Deps = { source: AtlassianSource; store: ImportStore; logger: JiraiaLogger }
type Found = Map<string, Account>

/** Reads in flight at once; each is one small S3 object. */
const READS = 12

const spacesSchema = z.array(z.looseObject({ key: z.string() }))
const treeSchema = z.array(z.object({ id: z.string(), type: z.string() }))
const pageFileSchema = z.looseObject({ versions: z.array(z.looseObject({ number: z.number() })).optional() })

/** Where the reviewed people live; 8c reads it. Personal data: the bucket only, never the repository. */
export const PEOPLE_PROPOSAL = 'import/people/proposal.json'
export const PEOPLE_MAPPING = 'import/people/mapping.json'

/**
 * Etapa 8b: lists every account the raw copies mention, fills in the names Confluence leaves out from
 * Jira's user API, and proposes who each one becomes (ADR-0036).
 */
export class PeopleScan {
  constructor(private readonly deps: Deps) {}

  async run(input: { jiraRun: string; confluenceRun: string; directoryKey: string }): Promise<Person[]> {
    const found: Found = new Map()
    await this.scanJira(input.jiraRun, found)
    await this.scanConfluence(input.confluenceRun, found)
    await this.fillNames(found)
    const directory = parseDirectory((await this.deps.store.getText(input.directoryKey)) ?? '')
    const people = proposePeople([...found.values()], directory)
    await this.deps.store.putJson(PEOPLE_PROPOSAL, people)
    this.deps.logger.info('People proposed', { accounts: people.length, directory: directory.length })
    return people
  }

  private async scanJira(run: string, found: Found): Promise<void> {
    const manifest = await this.deps.store.getJson(`import/${run}/jira/manifest.json`)
    if (manifest === undefined) {
      throw new NotFoundException('Import run', run)
    }
    await inPool(Object.values(manifestSchema.parse(manifest).issues), READS, async (entry) => {
      collectAccounts(await this.deps.store.getJson(entry.path), found)
    })
  }

  private async scanConfluence(run: string, found: Found): Promise<void> {
    const prefix = `import/${run}/confluence`
    const spaces = spacesSchema.parse((await this.deps.store.getJson(`${prefix}/spaces.json`)) ?? [])
    for (const space of spaces) {
      const tree = treeSchema.parse((await this.deps.store.getJson(`${prefix}/${space.key}/tree.json`)) ?? [])
      await inPool(tree, READS, async (node) => {
        const file = await this.deps.store.getJson(`${prefix}/${space.key}/${node.type}s/${node.id}.json`)
        collectAccounts(file, found)
        await this.scanVersions(node.id, file, found)
      })
    }
  }

  /** Old versions can mention people the current body no longer does. */
  private async scanVersions(pageId: string, file: unknown, found: Found): Promise<void> {
    for (const version of pageFileSchema.parse(file ?? {}).versions ?? []) {
      collectAccounts(await this.deps.store.getJson(versionKey(pageId, version.number)), found)
    }
  }

  /** Confluence names nobody, only ids; Jira's user API names them. */
  private async fillNames(found: Found): Promise<void> {
    const nameless = [...found.values()].filter((account) => account.name === undefined)
    const described = collectAccounts(await this.deps.source.users(nameless.map((account) => account.accountId)))
    for (const account of nameless) {
      const user = described.get(account.accountId)
      found.set(account.accountId, {
        ...account,
        name: user?.name ?? account.name,
        email: user?.email ?? account.email,
        active: user?.active ?? account.active,
        accountType: user?.accountType ?? account.accountType
      })
    }
  }
}
