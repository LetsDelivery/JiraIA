import { z } from 'zod'

import { cardRefSchema } from '../cards/link.schemas.js'
import { cardViewSchema, prioritySchema, stateGroupSchema } from '../cards/schemas.js'

/**
 * A day as `2026-10-01`, or days from now as `-7d` (before) or `+7d` (after) — what a saved view keeps,
 * so "the last seven days" stays the last seven days (Jira's `AFTER -7d`).
 */
export const dayBoundSchema = z.union([z.iso.date(), z.string().regex(/^[-+]\d{1,4}d$/)])
export type DayBound = z.infer<typeof dayBoundSchema>

const idsSchema = z.array(z.uuid()).min(1).max(100)
const labelListSchema = z.array(z.string().trim().min(1).max(60)).min(1).max(50)
const rangeSchema = z.object({ from: dayBoundSchema.optional(), to: dayBoundSchema.optional() })

/**
 * The structured equivalent of a JQL query (escopo-mvp 3.4): every condition named must hold. Within a
 * condition, any of the values listed matches. `me` and `none` stand for the caller and "nobody", so a
 * saved view of "my cards" works for whoever opens it.
 */
export const cardFilterSchema = z.object({
  spaceIds: idsSchema.optional(),
  typeIds: idsSchema.optional(),
  stateIds: idsSchema.optional(),
  notStateIds: idsSchema.optional(),
  stateGroups: z.array(stateGroupSchema).min(1).optional(),
  assignees: z
    .array(z.union([z.uuid(), z.enum(['me', 'none'])]))
    .min(1)
    .max(100)
    .optional(),
  reporters: z
    .array(z.union([z.uuid(), z.literal('me')]))
    .min(1)
    .max(100)
    .optional(),
  priorities: z.array(prioritySchema).min(1).optional(),
  labelsAny: labelListSchema.optional(),
  labelsNone: labelListSchema.optional(),
  /** In the title, the description or the key (`PRD-219`). */
  text: z.string().trim().min(1).max(200).optional(),
  created: rangeSchema.optional(),
  updated: rangeSchema.optional(),
  due: rangeSchema.optional(),
  /** Jira's `status CHANGED TO X AFTER D`: moved into one of these states since then. */
  movedTo: z.object({ stateIds: idsSchema, after: dayBoundSchema }).optional(),
  /** A custom field holding any of these values; for a multiple selection, any of its values (2.5). */
  fields: z
    .array(
      z.object({
        fieldId: z.uuid(),
        anyOf: z
          .array(z.union([z.string().max(200), z.number()]))
          .min(1)
          .max(50)
      })
    )
    .max(10)
    .optional()
})
export type CardFilter = z.infer<typeof cardFilterSchema>

export const cardOrderValues = ['created', 'updated', 'priority', 'due', 'key', 'title', 'rank'] as const
export const cardOrderSchema = z.object({
  by: z.enum(cardOrderValues),
  descending: z.boolean().default(false)
})
export type CardOrder = z.infer<typeof cardOrderSchema>

export const cardSearchSchema = z.object({
  filter: cardFilterSchema.default({}),
  order: cardOrderSchema.default({ by: 'rank', descending: false }),
  limit: z.number().int().min(1).max(500).default(200)
})
export type CardSearch = z.infer<typeof cardSearchSchema>
export const cardSearchResultSchema = z.object({ items: z.array(cardViewSchema) })

/** Global text search (3.6): `q` in a card's key, title or description, or in its comments. */
export const textSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20)
})
export const searchMatchSchema = z.enum(['key', 'title', 'description', 'comment'])
export type SearchMatch = z.infer<typeof searchMatchSchema>
export const textSearchResultSchema = z.object({
  /** The card the caller typed the key of, when `q` is one and they may open it. */
  exact: cardRefSchema.nullable(),
  items: z.array(z.object({ card: cardRefSchema, match: searchMatchSchema, excerpt: z.string() })),
  /** Pages and whiteboards of LET’S Draw AI whose title or text holds `q` (ADR-0011). */
  contents: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['page', 'whiteboard']),
      title: z.string(),
      spaceId: z.uuid(),
      spaceName: z.string(),
      excerpt: z.string()
    })
  )
})
export type TextSearchResult = z.infer<typeof textSearchResultSchema>
