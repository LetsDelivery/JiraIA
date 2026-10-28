import { type Clock, toIso } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'

import type { Raw } from './atlassian-source.js'
import type { ConfluenceNode, ConfluenceSource, ConfluenceSpace, NodeType, PageExtras } from './confluence-source.js'
import type { ImportStore } from './import-store.js'
import { inPool } from './jira-raw-copy.js'

/** Where a node sits: the tree is rebuilt from these rows in Draw (ADR-0011). */
export type TreeRow = ConfluenceNode & { parentId: string | null }

export type SpaceReport = Record<NodeType, number> & {
  key: string
  versions: number
  /** Version bodies downloaded in this run; the others were already stored. */
  versionBodies: number
  footerComments: number
  inlineComments: number
  attachments: number
  attachmentBytes: number
}
export type ConfluenceReport = {
  run: string
  startedAt: string
  finishedAt: string
  spaces: SpaceReport[]
  notVisible: string[]
}

type Deps = { source: ConfluenceSource; store: ImportStore; clock: Clock; logger: JiraiaLogger; concurrency?: number }

const emptyReport = (key: string): SpaceReport => ({
  key,
  page: 0,
  folder: 0,
  whiteboard: 0,
  database: 0,
  embed: 0,
  versions: 0,
  versionBodies: 0,
  footerComments: 0,
  inlineComments: 0,
  attachments: 0,
  attachmentBytes: 0
})

/** Comments and their replies, however deep. */
const countThread = (comments: Raw[]): number =>
  comments.reduce((sum, comment) => sum + 1 + countThread((comment.replies as Raw[] | undefined) ?? []), 0)

/** A version never changes once written, so its body lives once, outside any run. */
export const versionKey = (pageId: string, version: number): string =>
  `import/confluence/versions/${pageId}/${version}.json`

const versionNumbers = (versions: Raw[]): number[] =>
  versions.map((version) => Number(version.number)).filter((number) => Number.isInteger(number) && number > 0)

const sizeOf = (attachment: Raw): number => Number(attachment.fileSize ?? attachment.size) || 0

/**
 * Etapa 8a: copies Confluence as it is to the migration bucket, before anything is converted
 * (ADR-0036), and counts each space for the reconciliation report.
 *
 *     import/<run>/confluence/spaces.json · <space>/tree.json · <space>/<type>s/<id>.json · report.json
 */
export class ConfluenceRawCopy {
  constructor(private readonly deps: Deps) {}

  async run(input: { run: string; spaces: string[] }): Promise<ConfluenceReport> {
    const startedAt = toIso(this.deps.clock.now())
    const spaces = await this.deps.source.spaces(input.spaces)
    await this.deps.store.putJson(`import/${input.run}/confluence/spaces.json`, spaces)
    const reports: SpaceReport[] = []
    for (const space of spaces) {
      reports.push(await this.copySpace(space, input.run))
    }
    const visible = new Set(spaces.map((space) => space.key))
    const notVisible = input.spaces.filter((key) => !visible.has(key))
    const report = { run: input.run, startedAt, finishedAt: toIso(this.deps.clock.now()), spaces: reports, notVisible }
    await this.deps.store.putJson(`import/${input.run}/confluence/report.json`, report)
    return report
  }

  private async copySpace(space: ConfluenceSpace, run: string): Promise<SpaceReport> {
    const tree = await this.walk(space.id)
    const prefix = `import/${run}/confluence/${space.key}`
    await this.deps.store.putJson(`${prefix}/tree.json`, tree)
    const report = emptyReport(space.key)
    await inPool(tree, this.deps.concurrency ?? 6, async (node) => {
      await this.copyNode(node, prefix, report)
    })
    this.deps.logger.info('Confluence space copied', {
      space: space.key,
      pages: report.page,
      whiteboards: report.whiteboard
    })
    return report
  }

  /** Every node of a space, breadth first from its root pages, each once. */
  private async walk(spaceId: string): Promise<TreeRow[]> {
    const rows: TreeRow[] = (await this.deps.source.roots(spaceId)).map((root) => ({ ...root, parentId: null }))
    const seen = new Set(rows.map((row) => row.id))
    for (let index = 0; index < rows.length; index += 1) {
      const parent = rows[index] as TreeRow
      const fresh = (await this.deps.source.children(parent)).filter((child) => !seen.has(child.id))
      for (const child of fresh) {
        seen.add(child.id)
      }
      rows.push(...fresh.map((child) => ({ ...child, parentId: parent.id })))
    }
    return rows
  }

  private async copyNode(node: TreeRow, prefix: string, report: SpaceReport): Promise<void> {
    const body = await this.deps.source.node(node)
    const extras = node.type === 'page' ? await this.deps.source.pageExtras(node.id) : undefined
    await this.deps.store.putJson(`${prefix}/${node.type}s/${node.id}.json`, { node: body, ...extras })
    report[node.type] += 1
    if (extras) {
      await this.copyVersions(node.id, versionNumbers(extras.versions), report)
      this.tally(extras, report)
    }
  }

  private async copyVersions(pageId: string, numbers: number[], report: SpaceReport): Promise<void> {
    for (const number of numbers) {
      if (await this.deps.store.has(versionKey(pageId, number))) {
        continue
      }
      await this.deps.store.putJson(versionKey(pageId, number), await this.deps.source.pageVersion(pageId, number))
      report.versionBodies += 1
    }
  }

  private tally(extras: PageExtras, report: SpaceReport): void {
    report.versions += extras.versions.length
    report.footerComments += countThread(extras.footerComments)
    report.inlineComments += countThread(extras.inlineComments)
    report.attachments += extras.attachments.length
    report.attachmentBytes += extras.attachments.reduce((sum, attachment) => sum + sizeOf(attachment), 0)
  }
}
