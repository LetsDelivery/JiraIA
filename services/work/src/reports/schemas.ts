import { z } from 'zod'

import { prioritySchema, stateGroupSchema } from '../cards/schemas.js'

/** How much of the dashboard's row a widget takes: a quarter, a third, a half or all of it. */
export const widgetWidthSchema = z.enum(['quarter', 'third', 'half', 'full'])

/** Days and months are UTC; a week starts on Monday, as Postgres' `date_trunc('week')` (ADR-0016). */
export const intervalSchema = z.enum(['day', 'week', 'month'])
export type Interval = z.infer<typeof intervalSchema>

/** What a breakdown, or the rows of a matrix, groups the cards by. */
export const groupingValues = [
  'state',
  'state_group',
  'type',
  'assignee',
  'reporter',
  'priority',
  'squad',
  'label'
] as const
export const groupingSchema = z.enum(groupingValues)
export type Grouping = z.infer<typeof groupingSchema>

const daysSchema = (max: number) => z.number().int().min(1).max(max)

const widgetBase = {
  id: z.uuid(),
  /** Optional: without one, the panel names the widget from what it shows. */
  title: z.string().trim().min(1).max(80).optional(),
  width: widgetWidthSchema,
  /** A saved view of the same space whose filter narrows the cards counted (ADR-0008). */
  viewId: z.uuid().optional()
}

/**
 * One widget of a space's dashboard (ADR-0016). Each kind answers one question about the space's cards:
 * how many, split by what, over time, how fast, who holds what, and which ones.
 */
export const widgetSchema = z.discriminatedUnion('kind', [
  z.object({
    ...widgetBase,
    kind: z.literal('count'),
    measure: z.enum(['created', 'updated', 'completed', 'due_soon']),
    days: daysSchema(365)
  }),
  z.object({
    ...widgetBase,
    kind: z.literal('breakdown'),
    by: groupingSchema,
    chart: z.enum(['donut', 'bars'])
  }),
  z.object({
    ...widgetBase,
    kind: z.literal('trend'),
    measure: z.enum(['created', 'completed']),
    interval: intervalSchema,
    days: daysSchema(730)
  }),
  z.object({
    ...widgetBase,
    kind: z.literal('timing'),
    measure: z.enum(['cycle', 'lead']),
    interval: intervalSchema,
    days: daysSchema(730)
  }),
  z.object({ ...widgetBase, kind: z.literal('matrix'), by: z.enum(['assignee', 'squad', 'type']) }),
  z.object({ ...widgetBase, kind: z.literal('cards') }),
  /** A sprint's remaining work day by day (ADR-0029): the one named, or the active one. Ignores `viewId`. */
  z.object({ ...widgetBase, kind: z.literal('burndown'), sprintId: z.uuid().optional() }),
  /** Committed against completed in the space's last closed sprints. Ignores `viewId`. */
  z.object({ ...widgetBase, kind: z.literal('velocity'), sprints: z.number().int().min(1).max(12) })
])
export type Widget = z.infer<typeof widgetSchema>
export type WidgetOf<K extends Widget['kind']> = Extract<Widget, { kind: K }>

const widgetListSchema = z
  .array(widgetSchema)
  .max(30)
  .refine((widgets) => new Set(widgets.map((each) => each.id)).size === widgets.length, {
    message: 'Each widget needs an id of its own'
  })

export const saveDashboardSchema = z.object({ widgets: widgetListSchema })
export type SaveDashboard = z.infer<typeof saveDashboardSchema>

export const dashboardSchema = z.object({
  spaceId: z.uuid(),
  widgets: z.array(widgetSchema),
  /** True while the space shows the default dashboard: it never saved one, or restored it. */
  isDefault: z.boolean(),
  /** Whether the caller may save or restore it: the space's admins. */
  canEdit: z.boolean(),
  updatedAt: z.iso.datetime().nullable()
})
export type DashboardView = z.infer<typeof dashboardSchema>

export const runReportSchema = z.object({
  widget: widgetSchema,
  /** For a `cards` widget: which page of `CARDS_PAGE` cards, from 1. */
  page: z.number().int().min(1).max(1_000).default(1)
})
export type RunReport = z.infer<typeof runReportSchema>

export const CARDS_PAGE = 20

/** A slice is a state, a member, a label…: `key` is its id or value, `null` for "none". */
const sliceSchema = z.object({ key: z.string().nullable(), label: z.string().nullable(), count: z.number().int() })
export type Slice = z.infer<typeof sliceSchema>

export const bucketSchema = z.object({ start: z.iso.date(), count: z.number().int() })
export type Bucket = z.infer<typeof bucketSchema>

export const timingBucketSchema = z.object({
  start: z.iso.date(),
  /** The cards completed in the bucket that have this time. */
  count: z.number().int(),
  /** Their mean, in days; null when no card was completed. */
  averageDays: z.number().nullable()
})
export type TimingBucket = z.infer<typeof timingBucketSchema>

const columnSchema = z.object({ id: z.uuid(), name: z.string(), group: stateGroupSchema })
const matrixRowSchema = z.object({
  key: z.string().nullable(),
  label: z.string().nullable(),
  counts: z.array(z.number().int()),
  total: z.number().int()
})

export const reportCardSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  type: z.string(),
  priority: prioritySchema,
  state: z.object({ name: z.string(), group: stateGroupSchema }),
  assignee: z.object({ id: z.uuid(), name: z.string() }).nullable()
})
export type ReportCard = z.infer<typeof reportCardSchema>

/** What a sprint report adds: points where the space estimates in them, cards otherwise. */
const unitSchema = z.enum(['points', 'cards'])

const reportSprintSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  state: z.enum(['planned', 'active', 'closed']),
  startsOn: z.iso.date(),
  endsOn: z.iso.date()
})

const burndownDaySchema = z.object({
  day: z.iso.date(),
  /** What was left at the end of the day; null for a day still ahead. */
  remaining: z.number().nullable(),
  /** All that was in the sprint that day, done or not. */
  scope: z.number().nullable()
})

const velocitySprintSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  committed: z.number(),
  completed: z.number()
})

/** A widget's data, shaped by its kind. */
export const reportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count'), value: z.number().int() }),
  z.object({ kind: z.literal('breakdown'), total: z.number().int(), slices: z.array(sliceSchema) }),
  z.object({ kind: z.literal('trend'), buckets: z.array(bucketSchema) }),
  z.object({
    kind: z.literal('timing'),
    buckets: z.array(timingBucketSchema),
    averageDays: z.number().nullable()
  }),
  z.object({ kind: z.literal('matrix'), columns: z.array(columnSchema), rows: z.array(matrixRowSchema) }),
  z.object({
    kind: z.literal('cards'),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    items: z.array(reportCardSchema)
  }),
  z.object({
    kind: z.literal('burndown'),
    unit: unitSchema,
    /** Null when the space has no active sprint and none was named. */
    sprint: reportSprintSchema.nullable(),
    days: z.array(burndownDaySchema)
  }),
  z.object({
    kind: z.literal('velocity'),
    unit: unitSchema,
    /** Oldest first, so the chart reads left to right. */
    sprints: z.array(velocitySprintSchema),
    averageCompleted: z.number().nullable()
  })
])
export type Report = z.infer<typeof reportSchema>
