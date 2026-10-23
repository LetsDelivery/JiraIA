import type { Widget } from './schemas.js'

/** Fixed ids, so the default dashboard's widgets keep their identity between reads. */
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/**
 * The dashboard a space shows until its admins save one (ADR-0016): this week in four numbers, where
 * the items sit and with whom, how many come in and go out, how long they take, and the items.
 */
export const DEFAULT_WIDGETS: readonly Widget[] = [
  { id: id(1), kind: 'count', measure: 'completed', days: 7, width: 'quarter' },
  { id: id(2), kind: 'count', measure: 'updated', days: 7, width: 'quarter' },
  { id: id(3), kind: 'count', measure: 'created', days: 7, width: 'quarter' },
  { id: id(4), kind: 'count', measure: 'due_soon', days: 7, width: 'quarter' },
  { id: id(5), kind: 'breakdown', by: 'state', chart: 'donut', width: 'third' },
  { id: id(6), kind: 'breakdown', by: 'type', chart: 'donut', width: 'third' },
  { id: id(7), kind: 'breakdown', by: 'assignee', chart: 'donut', width: 'third' },
  { id: id(8), kind: 'trend', measure: 'created', interval: 'day', days: 30, width: 'half' },
  { id: id(9), kind: 'timing', measure: 'cycle', interval: 'week', days: 90, width: 'half' },
  { id: id(10), kind: 'timing', measure: 'lead', interval: 'week', days: 90, width: 'half' },
  { id: id(11), kind: 'trend', measure: 'completed', interval: 'month', days: 180, width: 'half' },
  { id: id(12), kind: 'cards', width: 'full' }
]

/** A space that plans in sprints starts its dashboard with the sprint (ADR-0029). */
export const SPRINT_WIDGETS: readonly Widget[] = [
  { id: id(13), kind: 'burndown', width: 'half' },
  { id: id(14), kind: 'velocity', sprints: 6, width: 'half' }
]

/** The default dashboard of a space, with the sprint first where it uses them. */
export const defaultWidgets = (usesSprints: boolean): Widget[] =>
  usesSprints ? [...SPRINT_WIDGETS, ...DEFAULT_WIDGETS] : [...DEFAULT_WIDGETS]
