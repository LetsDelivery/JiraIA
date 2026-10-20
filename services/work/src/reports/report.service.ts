import type { Clock } from '@jiraia/core'
import type { Caller } from '@jiraia/http'
import { and, eq, type SQL } from 'drizzle-orm'

import { prioritySchema, stateGroupSchema } from '../cards/schemas.js'
import type { MemberRow } from '../members/schemas.js'
import { cards } from '../schema.js'
import { filterCondition, visibleTo } from '../search/card-query.js'
import { cardFilterSchema } from '../search/filter.schemas.js'
import type { SpaceGate } from '../spaces/space-gate.js'
import type { ViewRepository } from '../views/view.repository.js'
import { bucketKeys, fillBuckets, windowStart } from './buckets.js'
import { spaceViewOrFail } from './dashboard.service.js'
import type { ReportRepository, Scope } from './report.repository.js'
import { CARDS_PAGE, type Report, type RunReport, type WidgetOf } from './schemas.js'

type Deps = { clock: Clock; gate: SpaceGate; reports: ReportRepository; views: ViewRepository }

const DAY = 86_400_000

/**
 * A widget's data (ADR-0016), for whoever reads the space: the widget may be saved or still in the
 * editor. Its cards are the space's, narrowed by the saved view it names.
 */
export class ReportService {
  constructor(private readonly deps: Deps) {}

  async run(caller: Caller, spaceId: string, input: RunReport): Promise<Report> {
    const { actor } = await this.deps.gate.check(caller, spaceId, 'space:read')
    const scope = { spaceId, where: await this._where(actor, spaceId, input.widget.viewId), now: this.deps.clock.now() }
    const widget = input.widget
    switch (widget.kind) {
      case 'count':
        return { kind: 'count', value: await this._count(scope, widget) }
      case 'breakdown':
        return await this._breakdown(scope, widget)
      case 'trend':
        return await this._trend(scope, widget)
      case 'timing':
        return await this._timing(scope, widget)
      case 'matrix':
        return await this._matrix(scope, widget)
      case 'cards':
        return await this._cards(scope, input.page)
    }
  }

  private async _where(actor: MemberRow, spaceId: string, viewId: string | undefined): Promise<SQL | undefined> {
    const own = and(eq(cards.spaceId, spaceId), visibleTo({ organizationId: actor.organizationId, meId: actor.id }))
    if (!viewId) {
      return own
    }
    const view = spaceViewOrFail(await this.deps.views.find(actor.organizationId, viewId), spaceId, viewId)
    const context = { meId: actor.id, now: this.deps.clock.now() }
    return and(own, filterCondition(cardFilterSchema.parse(view.filter), context))
  }

  private async _count(scope: Scope, widget: WidgetOf<'count'>): Promise<number> {
    const since = new Date(scope.now.getTime() - widget.days * DAY)
    const reports = this.deps.reports
    const measures = {
      created: () => reports.createdSince(scope, since),
      updated: () => reports.updatedSince(scope, since),
      completed: () => reports.completedSince(scope, since),
      due_soon: () => reports.dueWithin(scope, widget.days)
    }
    return await measures[widget.measure]()
  }

  private async _breakdown(scope: Scope, widget: WidgetOf<'breakdown'>): Promise<Report> {
    if (widget.by === 'label') {
      const [slices, total] = await Promise.all([this.deps.reports.labels(scope), this.deps.reports.count(scope)])
      return { kind: 'breakdown', total, slices }
    }
    const slices = await this.deps.reports.breakdown(scope, widget.by)
    return { kind: 'breakdown', total: slices.reduce((sum, each) => sum + each.count, 0), slices }
  }

  private async _trend(scope: Scope, widget: WidgetOf<'trend'>): Promise<Report> {
    const since = windowStart(scope.now, widget.days, widget.interval)
    const rows =
      widget.measure === 'created'
        ? await this.deps.reports.createdPer(scope, widget.interval, since)
        : await this.deps.reports.completedPer(scope, widget.interval, since)
    const keys = bucketKeys(scope.now, widget.days, widget.interval)
    const counts = fillBuckets(keys, new Map(rows.map((row) => [row.bucket, row.count])), 0)
    return { kind: 'trend', buckets: keys.map((start, index) => ({ start, count: counts[index] ?? 0 })) }
  }

  private async _timing(scope: Scope, widget: WidgetOf<'timing'>): Promise<Report> {
    const since = windowStart(scope.now, widget.days, widget.interval)
    const rows = await this.deps.reports.timingPer(scope, widget.measure, widget.interval, since)
    const keys = bucketKeys(scope.now, widget.days, widget.interval)
    const empty = { count: 0, averageDays: null }
    const filled = fillBuckets(keys, new Map(rows.map(({ bucket, ...row }) => [bucket, row])), empty)
    return {
      kind: 'timing',
      buckets: keys.map((start, index) => ({ start, ...(filled[index] ?? empty) })),
      averageDays: weightedMean(rows)
    }
  }

  private async _matrix(scope: Scope, widget: WidgetOf<'matrix'>): Promise<Report> {
    const [states, cells] = await Promise.all([
      this.deps.reports.states(scope.spaceId),
      this.deps.reports.matrix(scope, widget.by)
    ])
    const columns = states.map((state) => ({ ...state, group: stateGroupSchema.parse(state.group) }))
    return { kind: 'matrix', columns, rows: matrixRows(columns, cells) }
  }

  private async _cards(scope: Scope, page: number): Promise<Report> {
    const [total, rows] = await Promise.all([
      this.deps.reports.count(scope),
      this.deps.reports.page(scope, (page - 1) * CARDS_PAGE, CARDS_PAGE)
    ])
    const items = rows.map((card) => ({
      id: card.id,
      key: card.key,
      title: card.title,
      type: card.typeName,
      priority: prioritySchema.parse(card.priority),
      state: { name: card.stateName, group: stateGroupSchema.parse(card.stateGroup) },
      assignee: card.assigneeId ? { id: card.assigneeId, name: card.assigneeName ?? '' } : null
    }))
    return { kind: 'cards', total, page, pageSize: CARDS_PAGE, items }
  }
}

/** The mean over every card, not the mean of the buckets' means. */
export const weightedMean = (rows: readonly { count: number; averageDays: number | null }[]): number | null => {
  const counted = rows.filter((row) => row.averageDays !== null && row.count > 0)
  const cardsCounted = counted.reduce((sum, row) => sum + row.count, 0)
  if (!cardsCounted) {
    return null
  }
  return counted.reduce((sum, row) => sum + (row.averageDays ?? 0) * row.count, 0) / cardsCounted
}

type Cell = { key: string | null; label: string | null; stateId: string; count: number }

/** One row per assignee, squad or type, with a count per state in board order; the fullest row first. */
export const matrixRows = (columns: readonly { id: string }[], cells: readonly Cell[]) => {
  const rows = new Map<string | null, { key: string | null; label: string | null; counts: number[]; total: number }>()
  for (const cell of cells) {
    const row = rows.get(cell.key) ?? { key: cell.key, label: cell.label, counts: columns.map(() => 0), total: 0 }
    const column = columns.findIndex((each) => each.id === cell.stateId)
    row.counts[column] = (row.counts[column] ?? 0) + cell.count
    row.total += cell.count
    rows.set(cell.key, row)
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}
