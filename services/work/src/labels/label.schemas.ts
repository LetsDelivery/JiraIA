import { createHash } from 'node:crypto'

import { z } from 'zod'
import { type TypeColor, typeColorSchema } from '../cards/card-type.schemas.js'
import type { labels } from '../schema.js'

export type LabelRow = typeof labels.$inferSelect

/** A label takes one of the card types' colours (ADR-0032); grey is left for what has none chosen. */
const AUTO_COLORS: readonly TypeColor[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink']

/**
 * The colour a label starts with, from its name: the same name always gets the same colour, here and
 * in the SQL that registers a card's new labels (`labelColorSql`), so a label looks alike wherever it
 * was first used.
 *
 * @example colorOf('okr-saude-escala') // always the same one of the eight
 */
export const colorOf = (name: string): TypeColor =>
  AUTO_COLORS[Number.parseInt(createHash('md5').update(name).digest('hex').slice(0, 7), 16) % 8] as TypeColor

const nameSchema = z.string().trim().min(1).max(60)

export const labelViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: typeColorSchema,
  /** How many of the space's cards carry it. */
  cards: z.number()
})
export type LabelView = z.infer<typeof labelViewSchema>
export const labelListSchema = z.object({ items: z.array(labelViewSchema) })

export const createLabelSchema = z.object({ name: nameSchema, color: typeColorSchema.optional() })
/** A new name that another label already has joins the two. */
export const updateLabelSchema = z
  .object({ name: nameSchema.optional(), color: typeColorSchema.optional() })
  .refine((input) => input.name !== undefined || input.color !== undefined, { message: 'Send a name or a colour' })
export const labelPathSchema = z.object({ spaceId: z.uuid(), labelId: z.uuid() })
