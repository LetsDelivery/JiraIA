import { NotFoundException } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

import type { AtlassianSource } from './atlassian-source.js'
import type { ImportStore } from './import-store.js'
import { inPool, manifestSchema } from './jira-raw-copy.js'

export type WatcherReport = { run: string; issues: number; asked: number; watchers: number }

const watchCountSchema = z.object({
  issue: z.object({ fields: z.looseObject({ watches: z.looseObject({ watchCount: z.number() }).optional() }) })
})

/** Where an issue's watchers are kept, beside its raw copy. */
export const watchersKey = (run: string, issueId: string): string => `import/${run}/jira/watchers/${issueId}.json`

type Deps = { source: AtlassianSource; store: ImportStore; logger: JiraiaLogger; concurrency?: number }

/**
 * Etapa 8a, completed for 8c (ADR-0036): who watches each issue. An issue only counts its watchers;
 * Jira names them in a call of their own, made only for the issues that have any.
 */
export class JiraWatcherCopy {
  constructor(private readonly deps: Deps) {}

  async run(run: string): Promise<WatcherReport> {
    const manifest = await this.deps.store.getJson(`import/${run}/jira/manifest.json`)
    if (manifest === undefined) {
      throw new NotFoundException('Import run', run)
    }
    const entries = Object.values(manifestSchema.parse(manifest).issues)
    const report: WatcherReport = { run, issues: entries.length, asked: 0, watchers: 0 }
    await inPool(entries, this.deps.concurrency ?? 8, async (entry) => {
      const record = watchCountSchema.parse(await this.deps.store.getJson(entry.path))
      if ((record.issue.fields.watches?.watchCount ?? 0) === 0) {
        return
      }
      const issueId = entry.path.slice(entry.path.lastIndexOf('/') + 1, -'.json'.length)
      const watchers = await this.deps.source.watchers(issueId)
      await this.deps.store.putJson(watchersKey(run, issueId), watchers)
      report.asked += 1
      report.watchers += watchers.length
    })
    await this.deps.store.putJson(`import/${run}/jira/watchers-report.json`, report)
    this.deps.logger.info('Jira watchers copied', { ...report })
    return report
  }
}
