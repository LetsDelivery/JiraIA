import { type Clock, toIso } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

import type { AtlassianSource, IssueRecord, IssueStub } from './atlassian-source.js'
import type { ImportStore } from './import-store.js'

/** What one issue holds, counted once when copied and kept in the manifest for the runs after. */
export const tallySchema = z.object({
  comments: z.number(),
  changes: z.number(),
  worklogs: z.number(),
  attachments: z.number(),
  attachmentBytes: z.number(),
  links: z.number()
})
export type Tally = z.infer<typeof tallySchema>

/**
 * Where each issue's raw copy is and how fresh it is. A later run that finds the same `updated`
 * points at the earlier copy instead of asking Jira again — the cutover's delta (Etapa 8f).
 */
export const manifestSchema = z.object({
  run: z.string(),
  issues: z.record(z.string(), z.object({ key: z.string(), updated: z.string(), path: z.string(), tally: tallySchema }))
})
export type Manifest = z.infer<typeof manifestSchema>

export type ProjectReport = Tally & {
  key: string
  expected: number
  copied: number
  reused: number
  difference: number
}
export type JiraReport = {
  run: string
  startedAt: string
  finishedAt: string
  projects: ProjectReport[]
  notVisible: string[]
}

type Deps = { source: AtlassianSource; store: ImportStore; clock: Clock; logger: JiraiaLogger; concurrency?: number }
type Entry = Manifest['issues'][string]

const EMPTY: Tally = { comments: 0, changes: 0, worklogs: 0, attachments: 0, attachmentBytes: 0, links: 0 }

const arrayOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : []

/** Counts what an issue holds, the way the reconciliation report adds it up. */
export const tallyOf = (record: IssueRecord): Tally => {
  const fields = (record.issue.fields ?? {}) as Record<string, unknown>
  const attachments = arrayOf(fields.attachment)
  return {
    comments: record.comments.length,
    changes: record.changelog.length,
    worklogs: record.worklogs.length,
    attachments: attachments.length,
    attachmentBytes: attachments.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
    links: arrayOf(fields.issuelinks).length
  }
}

const add = (a: Tally, b: Tally): Tally => ({
  comments: a.comments + b.comments,
  changes: a.changes + b.changes,
  worklogs: a.worklogs + b.worklogs,
  attachments: a.attachments + b.attachments,
  attachmentBytes: a.attachmentBytes + b.attachmentBytes,
  links: a.links + b.links
})

/** Runs `work` over the items, at most `size` at a time. */
export const inPool = async <T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> => {
  const queue = [...items]
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
}

/**
 * Etapa 8a: copies Jira as it is to the migration bucket, before anything is converted (ADR-0036),
 * and counts both sides per project for the reconciliation report.
 *
 *     import/<run>/jira/projects.json · fields.json · issues/<id>.json · manifest.json · report.json
 */
export class JiraRawCopy {
  constructor(private readonly deps: Deps) {}

  async run(input: { run: string; projects: string[]; previousRun?: string }): Promise<JiraReport> {
    const startedAt = toIso(this.deps.clock.now())
    const visible = await this.copyCatalogue(input.run)
    const previous = await this.manifestOf(input.previousRun)
    const manifest: Manifest = { run: input.run, issues: {} }
    const projects: ProjectReport[] = []
    for (const key of input.projects.filter((project) => visible.has(project))) {
      projects.push(await this.copyProject(key, input.run, previous, manifest))
    }
    await this.deps.store.putJson(`import/${input.run}/jira/manifest.json`, manifest)
    const notVisible = input.projects.filter((project) => !visible.has(project))
    const report = { run: input.run, startedAt, finishedAt: toIso(this.deps.clock.now()), projects, notVisible }
    await this.deps.store.putJson(`import/${input.run}/jira/report.json`, report)
    return report
  }

  /** Projects and fields as Jira lists them; answers the keys the account can see. */
  private async copyCatalogue(run: string): Promise<Set<string>> {
    const projects = await this.deps.source.projects()
    await this.deps.store.putJson(`import/${run}/jira/projects.json`, projects)
    await this.deps.store.putJson(`import/${run}/jira/fields.json`, await this.deps.source.fields())
    return new Set(projects.map((project) => project.key))
  }

  private async manifestOf(run: string | undefined): Promise<Manifest | undefined> {
    const found = run ? await this.deps.store.getJson(`import/${run}/jira/manifest.json`) : undefined
    return found === undefined ? undefined : manifestSchema.parse(found)
  }

  private async copyProject(key: string, run: string, previous: Manifest | undefined, manifest: Manifest) {
    const expected = await this.deps.source.count(`project = "${key}"`)
    const stubs: IssueStub[] = []
    for await (const stub of this.deps.source.issueStubs(`project = "${key}" ORDER BY id`)) {
      stubs.push(stub)
    }
    let report: ProjectReport = { key, expected, copied: 0, reused: 0, difference: 0, ...EMPTY }
    await inPool(stubs, this.deps.concurrency ?? 6, async (stub) => {
      const { entry, reused } = await this.copyIssue(stub, run, previous)
      manifest.issues[stub.id] = entry
      report = {
        ...report,
        ...add(report, entry.tally),
        copied: report.copied + (reused ? 0 : 1),
        reused: report.reused + (reused ? 1 : 0)
      }
    })
    report.difference = expected - report.copied - report.reused
    this.deps.logger.info('Jira project copied', {
      project: key,
      expected,
      copied: report.copied,
      reused: report.reused
    })
    return report
  }

  private async copyIssue(stub: IssueStub, run: string, previous: Manifest | undefined) {
    const before = previous?.issues[stub.id]
    if (before && before.updated === stub.fields.updated) {
      return { entry: before, reused: true }
    }
    const record = await this.deps.source.issue(stub.id)
    const path = `import/${run}/jira/issues/${stub.id}.json`
    await this.deps.store.putJson(path, record)
    const entry: Entry = { key: stub.key, updated: stub.fields.updated, path, tally: tallyOf(record) }
    return { entry, reused: false }
  }
}
