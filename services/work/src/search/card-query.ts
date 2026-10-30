import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, notInArray, or, type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

import { auditEvents, cards, spaces, sprints, workflowStates } from '../schema.js'
import type { CardFilter, CardOrder, DayBound } from './filter.schemas.js'

/**
 * A `CardFilter` as SQL over `cards` joined to `spaces` (escopo-mvp 3.4). Every value is a bound
 * parameter, one per element — the Data API takes no array parameters (ADR-0002).
 */
const DAY = 86_400_000

export type QueryContext = { meId: string; now: Date }

/** Who may see what: every member reads every card of the organization (ADR-0012). */
export type Readable = { organizationId: string; meId: string }

const RELATIVE = /^([-+])(\d+)d$/

/**
 * A bound as an instant: a day starts at 00:00 UTC; `-7d` is seven days before now, `+7d` after.
 *
 * @example instantOf('-7d', new Date('2026-10-16T12:00:00Z'))   // 2026-10-09T12:00:00Z
 */
export const instantOf = (bound: DayBound, now: Date): Date => {
  const relative = RELATIVE.exec(bound)
  if (!relative) {
    return new Date(`${bound}T00:00:00.000Z`)
  }
  const sign = relative[1] === '-' ? -1 : 1
  return new Date(now.getTime() + sign * Number(relative[2]) * DAY)
}

/** Where a range `to` stops: after that whole day, or at the instant a relative bound names. */
const endOf = (bound: DayBound, now: Date): Date =>
  RELATIVE.test(bound) ? instantOf(bound, now) : new Date(instantOf(bound, now).getTime() + DAY)

const dayOf = (bound: DayBound, now: Date): string => instantOf(bound, now).toISOString().slice(0, 10)

const list = (values: readonly (string | number)[]): SQL =>
  sql.join(
    values.map((value) => sql`${String(value)}`),
    sql`, `
  )

const people = (column: PgColumn, values: readonly string[], meId: string): SQL | undefined => {
  const ids = values.filter((value) => value !== 'none').map((value) => (value === 'me' ? meId : value))
  return or(ids.length ? inArray(column, ids) : undefined, values.includes('none') ? isNull(column) : undefined)
}

const labels = (values: readonly string[], present: boolean): SQL => {
  const match = sql`exists (select 1 from jsonb_array_elements_text(${cards.labels}) as label where label in (${list(values)}))`
  return present ? match : sql`not ${match}`
}

const KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/

/** `%` and `_` typed by a person are text, not wildcards. */
export const likePattern = (query: string): string => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/** The card a typed key names, `prd-219` as `PRD-219`; nothing when the text is not a key. */
export const keyCondition = (query: string): SQL | undefined => {
  const key = KEY.exec(query.trim())
  return key ? and(eq(spaces.key, (key[1] ?? '').toUpperCase()), eq(cards.number, Number(key[2]))) : undefined
}

export const textCondition = (query: string): SQL | undefined =>
  or(ilike(cards.title, likePattern(query)), ilike(cards.description, likePattern(query)), keyCondition(query))

type Range = { from?: DayBound | undefined; to?: DayBound | undefined }

const instants = (column: PgColumn, range: Range, now: Date) =>
  and(
    range.from ? gte(column, instantOf(range.from, now)) : undefined,
    range.to ? lt(column, endOf(range.to, now)) : undefined
  )

const days = (column: PgColumn, range: Range, now: Date) =>
  and(
    range.from ? gte(column, dayOf(range.from, now)) : undefined,
    range.to ? lte(column, dayOf(range.to, now)) : undefined
  )

/** Moved into one of the states since `after`, by any write but the creation — as Jira's CHANGED TO. */
const movedTo = (moved: NonNullable<CardFilter['movedTo']>, now: Date): SQL => sql`exists (
  select 1 from ${auditEvents}
  where ${auditEvents.entityType} = 'card' and ${auditEvents.entityId} = ${cards.id}
    and ${auditEvents.action} <> 'created'
    and ${auditEvents.changes} -> 'stateId' ->> 'after' in (${list(moved.stateIds)})
    and ${auditEvents.occurredAt} >= ${instantOf(moved.after, now).toISOString()}::timestamptz)`

/** A custom value, one value or a list of them, holding any of `anyOf`. */
const field = (fieldId: string, anyOf: readonly (string | number)[]): SQL => {
  const value = sql`(${cards.customFields} -> ${fieldId}::text)`
  return sql`exists (select 1 from jsonb_array_elements_text(
    case when jsonb_typeof(${value}) = 'array' then ${value} else jsonb_build_array(${value}) end
  ) as value where value in (${list(anyOf)}))`
}

const inGroups = (groups: readonly string[]): SQL =>
  sql`${cards.stateId} in (select ${workflowStates.id} from ${workflowStates} where ${workflowStates.group} in (${list(groups)}))`

const DONE_STATES = sql`select ${workflowStates.id}::text from ${workflowStates} where ${workflowStates.group} = 'done'`

/** Not done, or entered a done state since `since` — or created since then, maybe done already. */
export const doneSinceCondition = (since: DayBound, now: Date): SQL => {
  const at = sql`${instantOf(since, now).toISOString()}::timestamptz`
  return sql`(not ${inGroups(['done'])} or ${cards.createdAt} >= ${at} or exists (
    select 1 from ${auditEvents}
    where ${auditEvents.entityType} = 'card' and ${auditEvents.entityId} = ${cards.id}
      and ${auditEvents.changes} -> 'stateId' ->> 'after' in (${DONE_STATES})
      and ${auditEvents.occurredAt} >= ${at}))`
}

/** In any of the sprints named: an id, the card's space's active sprint, or none at all. */
const inSprints = (values: readonly string[]): SQL | undefined => {
  const ids = values.filter((value) => value !== 'active' && value !== 'none')
  const active = sql`${cards.sprintId} in (select ${sprints.id} from ${sprints} where ${sprints.spaceId} = ${cards.spaceId} and ${sprints.state} = 'active')`
  return or(
    ids.length ? inArray(cards.sprintId, ids) : undefined,
    values.includes('active') ? active : undefined,
    values.includes('none') ? isNull(cards.sprintId) : undefined
  )
}

type Part = (filter: CardFilter, context: QueryContext) => SQL | undefined

/** One builder per condition of the filter; a condition left out builds nothing. */
const PARTS: readonly Part[] = [
  ({ spaceIds }) => spaceIds && inArray(cards.spaceId, spaceIds),
  ({ typeIds }) => typeIds && inArray(cards.typeId, typeIds),
  ({ stateIds }) => stateIds && inArray(cards.stateId, stateIds),
  ({ notStateIds }) => notStateIds && notInArray(cards.stateId, notStateIds),
  ({ stateGroups }) => stateGroups && inGroups(stateGroups),
  ({ priorities }) => priorities && inArray(cards.priority, priorities),
  ({ sprints: named }) => named && inSprints(named),
  ({ labelsAny }) => labelsAny && labels(labelsAny, true),
  ({ labelsNone }) => labelsNone && labels(labelsNone, false),
  ({ text }) => (text ? textCondition(text) : undefined),
  ({ fields }) => (fields ? and(...fields.map((each) => field(each.fieldId, each.anyOf))) : undefined),
  ({ assignees }, { meId }) => assignees && people(cards.assigneeId, assignees, meId),
  ({ reporters }, { meId }) => reporters && people(cards.reporterId, reporters, meId),
  ({ created }, { now }) => created && instants(cards.createdAt, created, now),
  ({ updated }, { now }) => updated && instants(cards.updatedAt, updated, now),
  ({ due }, { now }) => due && days(cards.dueDate, due, now),
  ({ movedTo: moved }, { now }) => moved && movedTo(moved, now),
  ({ doneSince: since }, { now }) => (since ? doneSinceCondition(since, now) : undefined)
]

export const filterCondition = (filter: CardFilter, context: QueryContext): SQL | undefined =>
  and(...PARTS.map((part) => part(filter, context)))

/** The cards the caller may open — the same rule the card gate applies one card at a time. */
export const visibleTo = (readable: Readable): SQL | undefined => eq(cards.organizationId, readable.organizationId)

const PRIORITY_ORDER = sql`case ${cards.priority} when 'highest' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`

const ORDER_BY: Record<Exclude<CardOrder['by'], 'key'>, SQL | PgColumn> = {
  created: cards.createdAt,
  updated: cards.updatedAt,
  priority: PRIORITY_ORDER,
  due: cards.dueDate,
  title: cards.title,
  rank: cards.rank
}

/** The order asked for, then the key, so two cards that tie always come in the same order. */
export const orderOf = (order: CardOrder): SQL[] => {
  const direction = order.descending ? desc : asc
  const primary = order.by === 'key' ? [] : [direction(ORDER_BY[order.by])]
  return [...primary, direction(spaces.key), direction(cards.number)]
}
