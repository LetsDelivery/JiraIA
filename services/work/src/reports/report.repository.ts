import type { Database } from '@jiraia/db'
import { and, asc, eq, isNotNull, type SQL, sql } from 'drizzle-orm'

import { workflowStates } from '../schema.js'
import { bucketOf, countAll, daysBetween, entries, groupOf, type ReportCards, reportCards } from './report-sql.js'
import type { Grouping, Interval, Slice } from './schemas.js'

const DAY = 86_400_000

/** The cards a widget counts: the space's, the caller's to read, narrowed by a saved view. */
export type Scope = { spaceId: string; where: SQL | undefined; now: Date }

export type Row = { bucket: string; count: number }
export type TimingRow = Row & { averageDays: number | null }
export type MatrixCell = { key: string | null; label: string | null; stateId: string; count: number }

const day = (at: Date): string => at.toISOString().slice(0, 10)

/** On or after an instant, bound as text so both database wires read it the same (ADR-0002). */
const since = (column: SQL, at: Date): SQL => sql`${column} >= ${at.toISOString()}::timestamptz`

/**
 * The reads behind a space's dashboard (ADR-0016). Each answers one widget with one set-based
 * statement over `report_cards`, so a dashboard costs about a statement per widget over the Data API.
 */
export class ReportRepository {
  constructor(private readonly db: Database) {}

  async count(scope: Scope, condition?: (base: ReportCards) => SQL): Promise<number> {
    const base = reportCards(this.db, scope.where)
    const [row] = await this.db.select({ count: countAll }).from(base).where(condition?.(base))
    return row?.count ?? 0
  }

  async createdSince(scope: Scope, at: Date): Promise<number> {
    return await this.count(scope, (base) => since(sql`${base.createdAt}`, at))
  }

  async updatedSince(scope: Scope, at: Date): Promise<number> {
    return await this.count(scope, (base) => since(sql`${base.updatedAt}`, at))
  }

  /** Open cards due from today to `days` days ahead — what Jira's "due soon" counts. */
  async dueWithin(scope: Scope, days: number): Promise<number> {
    const [first, last] = [day(scope.now), day(new Date(scope.now.getTime() + days * DAY))]
    return await this.count(
      scope,
      (base) =>
        sql`${base.stateGroup} in ('not_started', 'in_progress') and ${base.dueDate} between ${first}::date and ${last}::date`
    )
  }

  /** Cards in a `done` state now, whose last entry into one was at or after `at`. */
  async completedSince(scope: Scope, at: Date): Promise<number> {
    const base = reportCards(this.db, scope.where)
    const done = entries(this.db, scope.spaceId, 'done', 'completion')
    const [row] = await this.db
      .select({ count: countAll })
      .from(base)
      .innerJoin(done, eq(done.cardId, base.id))
      .where(and(eq(base.stateGroup, 'done'), since(sql`${done.at}`, at)))
    return row?.count ?? 0
  }

  async breakdown(scope: Scope, by: Exclude<Grouping, 'label'>): Promise<Slice[]> {
    const base = reportCards(this.db, scope.where)
    const { key, label } = groupOf(base, by)
    return await this.db
      .select({ key, label, count: countAll })
      .from(base)
      .groupBy(key, label)
      .orderBy(sql`count(*) desc`, asc(key))
  }

  /** A card with two labels counts in both; one with none counts under `null`. */
  async labels(scope: Scope): Promise<Slice[]> {
    const base = reportCards(this.db, scope.where)
    const key = sql<string | null>`label_value`
    const rows = await this.db
      .select({ key, count: countAll })
      .from(base)
      .leftJoin(sql`jsonb_array_elements_text(${base.labels}) as label_value`, sql`true`)
      .groupBy(key)
      .orderBy(sql`count(*) desc`, asc(key))
    return rows.map((row) => ({ ...row, label: row.key }))
  }

  async createdPer(scope: Scope, interval: Interval, at: Date): Promise<Row[]> {
    const base = reportCards(this.db, scope.where)
    const bucket = bucketOf(sql`${base.createdAt}`, interval)
    return await this.db
      .select({ bucket, count: countAll })
      .from(base)
      .where(since(sql`${base.createdAt}`, at))
      .groupBy(bucket)
  }

  async completedPer(scope: Scope, interval: Interval, at: Date): Promise<Row[]> {
    const base = reportCards(this.db, scope.where)
    const done = entries(this.db, scope.spaceId, 'done', 'completion')
    const bucket = bucketOf(sql`${done.at}`, interval)
    return await this.db
      .select({ bucket, count: countAll })
      .from(base)
      .innerJoin(done, eq(done.cardId, base.id))
      .where(and(eq(base.stateGroup, 'done'), since(sql`${done.at}`, at)))
      .groupBy(bucket)
  }

  /** Lead time from creation, cycle time from the first move into progress; both to completion. */
  async timingPer(scope: Scope, measure: 'cycle' | 'lead', interval: Interval, at: Date): Promise<TimingRow[]> {
    const base = reportCards(this.db, scope.where)
    const done = entries(this.db, scope.spaceId, 'done', 'completion')
    const started = entries(this.db, scope.spaceId, 'in_progress', 'start')
    const from = measure === 'lead' ? sql`${base.createdAt}` : sql`${started.at}`
    const averageDays = sql<number | null>`avg(${daysBetween(from, sql`${done.at}`)})::float8`
    const bucket = bucketOf(sql`${done.at}`, interval)
    const inProgress = measure === 'cycle' ? isNotNull(started.at) : undefined
    return await this.db
      .select({ bucket, count: countAll, averageDays })
      .from(base)
      .innerJoin(done, eq(done.cardId, base.id))
      .leftJoin(started, eq(started.cardId, base.id))
      .where(and(eq(base.stateGroup, 'done'), since(sql`${done.at}`, at), inProgress))
      .groupBy(bucket)
  }

  async matrix(scope: Scope, by: 'assignee' | 'squad' | 'type'): Promise<MatrixCell[]> {
    const base = reportCards(this.db, scope.where)
    const { key, label } = groupOf(base, by)
    return await this.db
      .select({ key, label, stateId: base.stateId, count: countAll })
      .from(base)
      .groupBy(key, label, base.stateId)
  }

  async states(spaceId: string) {
    return await this.db
      .select({ id: workflowStates.id, name: workflowStates.name, group: workflowStates.group })
      .from(workflowStates)
      .where(eq(workflowStates.spaceId, spaceId))
      .orderBy(asc(workflowStates.position))
  }

  /** One page of the cards, by number. */
  async page(scope: Scope, offset: number, limit: number) {
    const base = reportCards(this.db, scope.where)
    return await this.db.select().from(base).orderBy(asc(base.number)).offset(offset).limit(limit)
  }
}
