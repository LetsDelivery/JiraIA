import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { sprints } from '../schema.js'

export type SprintRow = typeof sprints.$inferSelect

/** Where a sprint is in its life (ADR-0029): planned, the one active, or closed for good. */
export const sprintStateSchema = z.enum(['planned', 'active', 'closed'])
export type SprintState = z.infer<typeof sprintStateSchema>

/** How much of a sprint, in cards and in points: committed at its start, completed and carried at its close. */
const tallySchema = z.object({ cards: z.number().int(), points: z.number() })

export const sprintViewSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  number: z.number().int(),
  name: z.string(),
  goal: z.string(),
  state: sprintStateSchema,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  startedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  committed: tallySchema.nullable(),
  completed: tallySchema.nullable(),
  carried: tallySchema.nullable()
})
export type SprintView = z.infer<typeof sprintViewSchema>
export const sprintListSchema = z.object({ items: z.array(sprintViewSchema) })

const nameSchema = z.string().trim().min(1).max(80)
const goalSchema = z.string().trim().max(500)

/** Everything optional: a new sprint is named and dated after the space's last one. */
export const createSprintSchema = z.object({
  name: nameSchema.optional(),
  goal: goalSchema.optional(),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().optional()
})
export type CreateSprint = z.infer<typeof createSprintSchema>

export const updateSprintSchema = z
  .object({
    name: nameSchema.optional(),
    goal: goalSchema.optional(),
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one field to change'
  })
export type UpdateSprint = z.infer<typeof updateSprintSchema>

/** Starting confirms — and may correct — the name, goal and dates. */
export const startSprintSchema = createSprintSchema

/** Where the cards still open go when a sprint closes. */
export const closeSprintSchema = z.object({ openCardsTo: z.enum(['next', 'new', 'backlog']) })
export type CloseSprint = z.infer<typeof closeSprintSchema>

export const sprintListQuerySchema = z.object({ state: sprintStateSchema.optional() })
export const sprintPathSchema = z.object({ sprintId: z.uuid() })

const _tally = (cards: number | null, points: number | null) => (cards === null ? null : { cards, points: points ?? 0 })

export const toSprintView = (row: SprintRow): SprintView => ({
  id: row.id,
  spaceId: row.spaceId,
  number: row.number,
  name: row.name,
  goal: row.goal,
  state: sprintStateSchema.parse(row.state),
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  startedAt: row.startedAt ? toIso(row.startedAt) : null,
  closedAt: row.closedAt ? toIso(row.closedAt) : null,
  committed: _tally(row.committedCards, row.committedPoints),
  completed: _tally(row.completedCards, row.completedPoints),
  carried: _tally(row.carriedCards, row.carriedPoints)
})
