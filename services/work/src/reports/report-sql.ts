import type { Database } from '@jiraia/db'
import { and, eq, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { auditEvents, cards, cardTypes, groups, members, spaces, workflowStates } from '../schema.js'
import type { Grouping, Interval } from './schemas.js'

const assignee = alias(members, 'assignee')
const reporter = alias(members, 'reporter')

/**
 * The cards a report counts — `where` holds the space, what the caller reads and the saved view —
 * with what a grouping or a row names: the state, the type, the people and the squad.
 */
export const reportCards = (db: Database, where: SQL | undefined) =>
  db
    .select({
      id: cards.id,
      number: cards.number,
      key: sql<string>`${spaces.key} || '-' || ${cards.number}`.as('card_key'),
      title: cards.title,
      priority: cards.priority,
      labels: cards.labels,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
      dueDate: cards.dueDate,
      stateId: cards.stateId,
      stateName: sql<string>`${workflowStates.name}`.as('state_name'),
      stateGroup: sql<string>`${workflowStates.group}`.as('state_group'),
      typeId: cards.typeId,
      typeName: sql<string>`${cardTypes.name}`.as('type_name'),
      assigneeId: cards.assigneeId,
      assigneeName: sql<string | null>`${assignee.name}`.as('assignee_name'),
      reporterId: cards.reporterId,
      reporterName: sql<string | null>`${reporter.name}`.as('reporter_name'),
      squadId: cards.groupId,
      squadName: sql<string | null>`${groups.name}`.as('squad_name')
    })
    .from(cards)
    .innerJoin(spaces, eq(spaces.id, cards.spaceId))
    .innerJoin(workflowStates, eq(workflowStates.id, cards.stateId))
    .innerJoin(cardTypes, eq(cardTypes.id, cards.typeId))
    .leftJoin(assignee, eq(assignee.id, cards.assigneeId))
    .leftJoin(reporter, eq(reporter.id, cards.reporterId))
    .leftJoin(groups, eq(groups.id, cards.groupId))
    .where(where)
    .as('report_cards')

export type ReportCards = ReturnType<typeof reportCards>

type Group = { key: SQL<string | null>; label: SQL<string | null> }

/**
 * What a card is grouped by, as a key and a label. A label of `null` means the panel names the key
 * itself (a priority, a state group); a key of `null` means "none" (no assignee, no squad).
 */
export const groupOf = (base: ReportCards, by: Exclude<Grouping, 'label'>): Group => {
  const groupings: Record<Exclude<Grouping, 'label'>, Group> = {
    state: { key: sql`${base.stateId}::text`, label: sql`${base.stateName}` },
    state_group: { key: sql`${base.stateGroup}`, label: sql`null::text` },
    type: { key: sql`${base.typeId}::text`, label: sql`${base.typeName}` },
    assignee: { key: sql`${base.assigneeId}::text`, label: sql`${base.assigneeName}` },
    reporter: { key: sql`${base.reporterId}::text`, label: sql`${base.reporterName}` },
    priority: { key: sql`${base.priority}`, label: sql`null::text` },
    squad: { key: sql`${base.squadId}::text`, label: sql`${base.squadName}` }
  }
  return groupings[by]
}

export const countAll = sql<number>`count(*)::int`

/** Written into the statement, not bound: a bound unit would make `group by` differ from `select`. */
const UNITS: Record<Interval, SQL> = { day: sql.raw(`'day'`), week: sql.raw(`'week'`), month: sql.raw(`'month'`) }

/** `at`'s UTC day, ISO week or month, as `YYYY-MM-DD` — the keys `bucketKeys` makes. */
export const bucketOf = (at: SQL, interval: Interval): SQL<string> =>
  sql<string>`to_char(date_trunc(${UNITS[interval]}, ${at} at time zone 'UTC'), 'YYYY-MM-DD')`

/**
 * When each card of the space entered a state of `group`, from the audit trail (ADR-0016): the last
 * entry for `done` (a reopened card counts from its last completion), the first for `in_progress`.
 */
export const entries = (db: Database, spaceId: string, group: 'done' | 'in_progress', name: string) => {
  const at = group === 'done' ? sql`max(${auditEvents.occurredAt})` : sql`min(${auditEvents.occurredAt})`
  return db
    .select({ cardId: auditEvents.entityId, at: sql<string>`${at}`.as(`${name}_at`) })
    .from(auditEvents)
    .innerJoin(workflowStates, sql`${auditEvents.changes} -> 'stateId' ->> 'after' = ${workflowStates.id}::text`)
    .where(
      and(
        eq(auditEvents.entityType, 'card'),
        eq(auditEvents.spaceId, spaceId),
        eq(workflowStates.spaceId, spaceId),
        eq(workflowStates.group, group)
      )
    )
    .groupBy(auditEvents.entityId)
    .as(name)
}

/** Days between two timestamps, as a fraction. */
export const daysBetween = (from: SQL, to: SQL): SQL<number> =>
  sql<number>`extract(epoch from (${to} - ${from})) / 86400`
