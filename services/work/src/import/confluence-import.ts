import { type Clock, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

import type { Raw } from './atlassian-source.js'
import type { AttachmentFiles } from './attachment-files.js'
import { ConfluenceRepository } from './confluence.repository.js'
import { type BackupDocument, dateOf, parseBackup } from './confluence-content.js'
import { ConfluenceContents, type ContentTally } from './confluence-contents.js'
import {
  auditEvent,
  type ImportContext,
  type LoadedSpace,
  type NodeFile,
  type RefEntity,
  refRow,
  whoOf
} from './confluence-context.js'
import type { TreeRow } from './confluence-raw-copy.js'
import { ImportRepository } from './import.repository.js'
import { ImportMembers } from './import-members.js'
import type { ImportStore } from './import-store.js'
import { inPool } from './jira-raw-copy.js'
import { collectAccounts, personSchema } from './people.js'
import { PEOPLE_MAPPING } from './people-scan.js'

export type ConfluenceSpaceTally = ContentTally & { key: string; name: string }
export type ConfluenceImportReport = {
  run: string
  rawRun: string
  spaces: ConfluenceSpaceTally[]
  unmappedAccounts: string[]
}

type Deps = {
  db: Database
  store: ImportStore
  files: AttachmentFiles
  clock: Clock
  ids: IdGenerator
  logger: JiraiaLogger
}
type Input = { organizationId: string; actorId: string; rawRun: string; run: string; spaces?: string[] }

const BACKUP = (part: number) => `import/confluence/whiteboards/whiteboardExport_${part}.csv`
const ENTITIES: RefEntity[] = ['space', 'content', 'file', 'version', 'comment']

/** Each space's emoji in Draw; a space not listed shows a book. */
const ICONS = new Map([
  ['BA', '💻'],
  ['Produto', '📦'],
  ['CS', '🤝'],
  ['CSB', '🤝'],
  ['LD', '🚚'],
  ['DEMO', '🧪'],
  ['PERF', '📈'],
  ['team9e949cb32355422b970994e76dcc60a1', '🎨']
])

const spaceListSchema = z.array(z.looseObject({ id: z.string(), key: z.string(), name: z.string() }))

/**
 * Etapa 8e (ADR-0036): writes a raw Confluence copy into LET'S Draw — each space a Draw space every
 * active member edits, its folders, pages, whiteboards, databases and embeds in Confluence's tree and
 * order, with their files, every version and every comment, by their original authors and dates. Every
 * row is remembered in `import_refs`, so running again adds what is new and skips the rest.
 */
export class ConfluenceImport {
  private readonly repository: ConfluenceRepository
  private readonly refs: ImportRepository

  constructor(private readonly deps: Deps) {
    this.repository = new ConfluenceRepository(deps.db)
    this.refs = new ImportRepository(deps.db)
  }

  async run(input: Input): Promise<ConfluenceImportReport> {
    const loaded = await this.load(input)
    const context = await this.contextOf(input, loaded)
    const spaces: ConfluenceSpaceTally[] = []
    for (const space of loaded) {
      spaces.push(await this.importSpace(context, space))
    }
    return { run: input.run, rawRun: input.rawRun, spaces, unmappedAccounts: context.people.unmapped }
  }

  private async load(input: Input): Promise<LoadedSpace[]> {
    const prefix = `import/${input.rawRun}/confluence`
    const listed = await this.deps.store.getJson(`${prefix}/spaces.json`)
    if (listed === undefined) {
      throw new NotFoundException('Import run', input.rawRun)
    }
    const spaces = spaceListSchema.parse(listed).filter((space) => !input.spaces || input.spaces.includes(space.key))
    const loaded: LoadedSpace[] = []
    for (const space of spaces) {
      const rows = ((await this.deps.store.getJson(`${prefix}/${space.key}/tree.json`)) ?? []) as TreeRow[]
      const nodes = new Map<string, NodeFile>()
      await inPool(rows, 16, async (row) => {
        const file = await this.deps.store.getJson(`${prefix}/${space.key}/${row.type}s/${row.id}.json`)
        if (file) {
          nodes.set(row.id, file as NodeFile)
        }
      })
      loaded.push({ space, rows, nodes })
    }
    return loaded
  }

  private async contextOf(input: Input, loaded: LoadedSpace[]): Promise<ImportContext> {
    const at = this.deps.clock.now()
    const people = await new ImportMembers({ db: this.deps.db, repository: this.refs, ids: this.deps.ids }).ensure({
      organizationId: input.organizationId,
      run: input.run,
      at,
      mapping: z.array(personSchema).parse((await this.deps.store.getJson(PEOPLE_MAPPING)) ?? []),
      seen: [...collectAccounts(loaded.map((space) => [space.space, ...space.nodes.values()])).values()]
    })
    const { names, active } = await this.repository.people(input.organizationId)
    const refs = await Promise.all(ENTITIES.map((entity) => this.refs.refs(input.organizationId, 'confluence', entity)))
    return {
      organizationId: input.organizationId,
      actorId: input.actorId,
      run: input.run,
      at,
      people,
      names,
      active,
      backup: await this.backup(),
      attachments: attachmentsByFile(loaded),
      refs: Object.fromEntries(ENTITIES.map((entity, index) => [entity, refs[index]])) as ImportContext['refs']
    }
  }

  /** The site backup's whiteboards and databases, from every part of its export. */
  private async backup(): Promise<Map<string, BackupDocument>> {
    const found = new Map<string, BackupDocument>()
    for (let part = 1; ; part += 1) {
      const csv = await this.deps.store.getText(BACKUP(part))
      if (csv === undefined) {
        return found
      }
      for (const [id, document] of parseBackup(csv)) {
        found.set(id, document)
      }
    }
  }

  private async importSpace(context: ImportContext, loaded: LoadedSpace): Promise<ConfluenceSpaceTally> {
    const spaceId = await this.ensureSpace(context, loaded.space)
    const contents = new ConfluenceContents({ ...this.deps, repository: this.repository, refs: this.refs })
    const tally = await contents.import(context, loaded, spaceId)
    await this.deps.db.transaction(async (tx) => {
      await this.repository.audit(tx, [
        auditEvent(context, this.deps.ids.next(), {
          spaceId,
          entityType: 'draw_space',
          entityId: spaceId,
          action: 'imported',
          actorId: context.actorId,
          at: context.at,
          changes: { run: { before: null, after: context.run }, contents: { before: null, after: tally.contents } }
        })
      ])
    })
    const key = String(loaded.space.key)
    this.deps.logger.info('Confluence space imported', { space: key, inserted: tally.contents.inserted })
    return { key, name: String(loaded.space.name), ...tally }
  }

  /** The space, created once with Confluence's author and date; every active member may edit it. */
  private async ensureSpace(context: ImportContext, space: Raw): Promise<string> {
    const source = String(space.id)
    const ref = context.refs.space.get(source)
    const id = ref?.targetId ?? this.deps.ids.next()
    const author = whoOf(context)(space.authorId)
    const createdAt = dateOf(space.createdAt, context.at)
    await this.deps.db.transaction(async (tx) => {
      if (ref) {
        await this.repository.renameSpace(tx, id, String(space.name), context.at)
      } else {
        await this.repository.insertSpace(tx, {
          id,
          organizationId: context.organizationId,
          name: String(space.name),
          description: `Migrado do Confluence (${String(space.key)}).`,
          icon: ICONS.get(String(space.key)) ?? '📘',
          area: 'draw',
          createdBy: author,
          createdAt,
          updatedAt: context.at
        })
        await this.repository.audit(tx, [
          auditEvent(context, this.deps.ids.next(), {
            spaceId: id,
            entityType: 'draw_space',
            entityId: id,
            action: 'created',
            actorId: author,
            at: createdAt,
            changes: { name: { before: null, after: String(space.name) } }
          })
        ])
      }
      await this.repository.grant(tx, grants(context, id, author))
      await this.refs.putRefs(tx, [refRow(context, 'space', source, id)])
    })
    context.refs.space.set(source, { targetId: id, contentHash: '' })
    return id
  }
}

/** The importer and the space's author hold it; every other active member edits it. */
const grants = (context: ImportContext, spaceId: string, author: string) => {
  const admins = [...new Set([context.actorId, ...(context.active.includes(author) ? [author] : [])])]
  const createdAt = context.at
  return [
    ...admins.map((memberId) => ({ spaceId, memberId, role: 'admin', createdAt })),
    ...context.active
      .filter((memberId) => !admins.includes(memberId))
      .map((memberId) => ({ spaceId, memberId, role: 'member', createdAt }))
  ]
}

/** Every attachment of the run, by Confluence's file id: a page may show a file attached elsewhere. */
const attachmentsByFile = (loaded: LoadedSpace[]): Map<string, Raw> =>
  new Map(
    loaded.flatMap((space) =>
      [...space.nodes.values()].flatMap((file) =>
        (file.attachments ?? []).map((attachment) => [String(attachment.fileId), attachment] as [string, Raw])
      )
    )
  )
