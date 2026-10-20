import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { savedViews } from '../schema.js'
import { cardFilterSchema, cardOrderSchema } from '../search/filter.schemas.js'

export type SavedViewRow = typeof savedViews.$inferSelect

/** Personal: the owner's alone. Space: everyone who reads the space sees it (escopo-mvp 3.5). */
export const viewScopeSchema = z.enum(['personal', 'space'])
/** The tab the view opens on: the board, the list or the backlog (3.1–3.3). */
export const viewLayoutSchema = z.enum(['board', 'list', 'backlog'])
/** The board's swimlanes, as the panel offers them (3.1). */
export const viewLanesSchema = z.enum(['none', 'assignee', 'priority', 'type', 'parent'])

const nameSchema = z.string().trim().min(1).max(80)
const columnsSchema = z.array(z.string().min(1).max(60)).max(30)
const defaultOrder = { by: 'rank', descending: false } as const

export const createViewSchema = z
  .object({
    name: nameSchema,
    scope: viewScopeSchema,
    /** The space the view is listed in; required for a space's view, optional for a personal one. */
    spaceId: z.uuid().optional(),
    filter: cardFilterSchema.default({}),
    order: cardOrderSchema.default(defaultOrder),
    layout: viewLayoutSchema.default('list'),
    lanes: viewLanesSchema.default('none'),
    columns: columnsSchema.default([])
  })
  .refine((input) => input.scope === 'personal' || input.spaceId !== undefined, {
    message: 'A space view needs a spaceId',
    path: ['spaceId']
  })
export type CreateView = z.infer<typeof createViewSchema>

export const updateViewSchema = z
  .object({
    name: nameSchema.optional(),
    filter: cardFilterSchema.optional(),
    order: cardOrderSchema.optional(),
    layout: viewLayoutSchema.optional(),
    lanes: viewLanesSchema.optional(),
    columns: columnsSchema.optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one field to change'
  })
export type UpdateView = z.infer<typeof updateViewSchema>

export const viewListQuerySchema = z.object({ spaceId: z.uuid().optional() })
export const viewPathSchema = z.object({ viewId: z.uuid() })

export const viewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scope: viewScopeSchema,
  spaceId: z.uuid().nullable(),
  owner: z.object({ id: z.uuid(), name: z.string() }),
  filter: cardFilterSchema,
  order: cardOrderSchema,
  layout: viewLayoutSchema,
  lanes: viewLanesSchema,
  columns: columnsSchema,
  /** Whether the caller may rename, change or delete it: its owner, or an admin of its space. */
  canEdit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type ViewView = z.infer<typeof viewSchema>
export const viewListSchema = z.object({ items: z.array(viewSchema) })

export type ViewWithOwner = SavedViewRow & { ownerName: string }

export const toViewView = (row: ViewWithOwner, canEdit: boolean): ViewView => ({
  id: row.id,
  name: row.name,
  scope: viewScopeSchema.parse(row.scope),
  spaceId: row.spaceId,
  owner: { id: row.ownerId, name: row.ownerName },
  filter: cardFilterSchema.parse(row.filter),
  order: cardOrderSchema.parse(row.order),
  layout: viewLayoutSchema.parse(row.layout),
  lanes: viewLanesSchema.parse(row.lanes),
  columns: columnsSchema.parse(row.columns),
  canEdit,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt)
})
