import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { Changes } from '../audit/audit.js'
import { auditEvents } from '../schema.js'
import type { IssueRecord, Raw } from './atlassian-source.js'
import type { ImportRepository, RefRow } from './import.repository.js'
import type { CardContext } from './jira-card-rows.js'
import { type HistoryNames, historyEventsOf } from './jira-history-mapping.js'
import { chunk, fieldsOf, userOf } from './jira-mapping.js'

export type HistoryTally = { events: number; entries: number; unchanged: number }
type Deps = { db: Database; repository: ImportRepository; clock: Clock; ids: IdGenerator }
type Input = {
  run: string
  spaceId: string
  records: IssueRecord[]
  cardIds: Map<string, string>
  context: CardContext
}
type Event = typeof auditEvents.$inferInsert
type Planned = { events: Event[]; ref: RefRow }

/**
 * Etapa 8d (ADR-0036): a card's past as its audit trail — when it was created, every change Jira
 * recorded, every comment — with Jira's own dates and authors, `via: 'Jira'`. Each event is written
 * already dispatched, so no notice, e-mail, webhook, Slack message or automation leaves for the past;
 * reports and dashboards that read the trail (ADR-0016) see it whole. Each source entry is written once.
 */
export class JiraHistory {
  constructor(private readonly deps: Deps) {}

  async import(input: Input): Promise<HistoryTally> {
    const done = await this.deps.repository.refs(input.context.organizationId, 'jira', 'history')
    const names = await this.namesOf(input.context)
    const planned = input.records
      .flatMap((record) => this.planCard(record, input, names))
      .filter((entry) => !done.has(entry.ref.sourceId))
    for (const batch of chunk(planned, 150)) {
      await this.deps.db.transaction(async (tx) => {
        await tx.insert(auditEvents).values(batch.flatMap((entry) => entry.events))
        await this.deps.repository.putRefs(
          tx,
          batch.map((entry) => entry.ref)
        )
      })
    }
    const events = planned.reduce((sum, entry) => sum + entry.events.length, 0)
    return { events, entries: planned.length, unchanged: done.size }
  }

  private async namesOf(context: CardContext): Promise<HistoryNames> {
    const cards = await this.deps.repository.refs(context.organizationId, 'jira', 'card')
    const fields = new Map(context.catalogue.fields.map((field) => [field.jiraId, field.id]))
    return {
      stateId: (name) => context.catalogue.stateId.get(name),
      typeId: (name) => context.catalogue.typeId.get(name),
      memberOf: (accountId) => context.people.memberOf(accountId),
      sprintId: (id) => context.catalogue.sprintId.get(id),
      cardId: (issueId) => cards.get(issueId)?.targetId,
      fieldId: (jiraId) => fields.get(jiraId),
      storyPointsField: context.storyPointsField,
      sprintField: context.sprintField,
      rankField: context.rankField
    }
  }

  /** The card's creation, each changelog entry and each comment: one planned unit each, by Jira's id. */
  private planCard(record: IssueRecord, input: Input, names: HistoryNames): Planned[] {
    const cardId = input.cardIds.get(String(record.issue.key))
    if (!cardId) {
      return []
    }
    const fields = fieldsOf(record)
    const key = String(record.issue.key)
    const updated = new Date(String(fields.updated))
    const source = (id: string, at: unknown, author: unknown): Source => ({
      cardId,
      id,
      at: dateOr(at, updated),
      author
    })
    return [
      this.unit(
        input,
        source(`created:${record.issue.id}`, fields.created, fields.reporter ?? fields.creator),
        CREATED
      ),
      ...record.changelog.map((entry) =>
        this.unit(
          input,
          source(String(entry.id), entry.created, entry.author),
          historyEventsOf(itemsOf(entry), names, key)
        )
      ),
      ...record.comments.map((comment) =>
        this.unit(input, source(`comment:${comment.id}`, comment.created, comment.author), COMMENTED)
      )
    ].filter((entry) => entry.events.length > 0)
  }

  private unit(input: Input, source: Source, found: { action: string; changes: Changes }[]): Planned {
    const account = userOf(source.author)
    const actorId = (account && input.context.people.memberOf(account.accountId)) || input.context.actorId
    const events = found.map(({ action, changes }) => ({
      id: this.deps.ids.next(),
      organizationId: input.context.organizationId,
      spaceId: input.spaceId,
      actorId,
      entityType: 'card',
      entityId: source.cardId,
      action,
      changes,
      occurredAt: source.at,
      dispatchedAt: this.deps.clock.now(),
      via: 'Jira'
    }))
    const ref: RefRow = {
      organizationId: input.context.organizationId,
      source: 'jira',
      entity: 'history',
      sourceId: source.id,
      targetId: events[0]?.id ?? source.cardId,
      contentHash: '',
      runId: input.run,
      importedAt: this.deps.clock.now()
    }
    return { events, ref }
  }
}

/** Where a unit of history comes from: the card, Jira's id for it, when and by whom. */
type Source = { cardId: string; id: string; at: Date; author: unknown }

const CREATED = [{ action: 'created', changes: {} }]
const COMMENTED = [{ action: 'commented', changes: {} }]

/** Jira's date, or — for an entry that has none — the card's last update, so it still sorts in. */
const dateOr = (value: unknown, fallback: Date): Date => {
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const itemsOf = (entry: Raw): Raw[] => (Array.isArray(entry.items) ? (entry.items as Raw[]) : [])
