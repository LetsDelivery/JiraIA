import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { cardWatchers, cardWorklogs } from '../schema.js'
import { adfToMarkdown } from './adf-markdown.js'
import type { IssueRecord, Raw } from './atlassian-source.js'
import type { ImportRepository, RefRow } from './import.repository.js'
import type { People } from './import-members.js'
import { mentionOf } from './jira-card-rows.js'
import { chunk, userOf } from './jira-mapping.js'

export type WatcherTally = { watchers: number; worklogs: number }
type Deps = { db: Database; repository: ImportRepository; clock: Clock; ids: IdGenerator }
type Input = {
  organizationId: string
  run: string
  actorId: string
  records: IssueRecord[]
  cardIds: Map<string, string>
  /** Each issue's watchers, by Jira issue id, from the raw copy's `watchers/`. */
  watchers: Map<string, Raw[]>
  people: People
}

/** Apps watch nothing in JiraIA; a person who left still watched, as an inactive member. */
const isPerson = (account: Raw): boolean => account.accountType !== 'app'

/**
 * Etapa 8c (ADR-0036): who watches each card, and the time logged on it. Watchers are added, never
 * removed — someone who started watching in JiraIA keeps watching; a worklog is written once, by its
 * Jira id. Nobody is notified: a watcher only hears about changes made from now on.
 */
export class JiraWatchersWorklogs {
  constructor(private readonly deps: Deps) {}

  async import(input: Input): Promise<WatcherTally> {
    const watchers = this.watcherRows(input)
    const worklogs = await this.worklogRows(input)
    for (const batch of chunk(watchers, 200)) {
      await this.deps.db.insert(cardWatchers).values(batch).onConflictDoNothing()
    }
    for (const batch of chunk(worklogs, 100)) {
      await this.deps.db.transaction(async (tx) => {
        await tx.insert(cardWorklogs).values(batch.map((entry) => entry.row))
        await this.deps.repository.putRefs(
          tx,
          batch.map((entry) => entry.ref)
        )
      })
    }
    return { watchers: watchers.length, worklogs: worklogs.length }
  }

  private watcherRows(input: Input): (typeof cardWatchers.$inferInsert)[] {
    const at = this.deps.clock.now()
    return input.records.flatMap((record) => {
      const cardId = input.cardIds.get(String(record.issue.key))
      const accounts = (input.watchers.get(String(record.issue.id)) ?? []).filter(isPerson)
      const members = accounts.map((account) => input.people.memberOf(String(account.accountId)))
      const unique = [...new Set(members.filter((member): member is string => member !== undefined))]
      return cardId ? unique.map((memberId) => ({ cardId, memberId, createdAt: at })) : []
    })
  }

  private async worklogRows(input: Input) {
    const done = await this.deps.repository.refs(input.organizationId, 'jira', 'worklog')
    const mention = mentionOf(input.people)
    return input.records.flatMap((record) => {
      const cardId = input.cardIds.get(String(record.issue.key))
      const fresh = record.worklogs.filter((worklog) => !done.has(String(worklog.id)))
      return cardId ? fresh.map((worklog) => this.worklogRow(worklog, cardId, input, mention)) : []
    })
  }

  private worklogRow(worklog: Raw, cardId: string, input: Input, mention: (accountId: string) => string | undefined) {
    const id = this.deps.ids.next()
    const author = userOf(worklog.author)
    const row = {
      id,
      cardId,
      authorId: (author && input.people.memberOf(author.accountId)) || input.actorId,
      startedAt: new Date(String(worklog.started)),
      seconds: Number(worklog.timeSpentSeconds) || 0,
      comment: adfToMarkdown(worklog.comment ?? null, { mention }),
      createdAt: new Date(String(worklog.created ?? worklog.started))
    }
    const ref: RefRow = {
      organizationId: input.organizationId,
      source: 'jira',
      entity: 'worklog',
      sourceId: String(worklog.id),
      targetId: id,
      contentHash: '',
      runId: input.run,
      importedAt: this.deps.clock.now()
    }
    return { row, ref }
  }
}
