import { z } from 'zod'

import type { cardLinks } from '../schema.js'
import { stateGroupSchema } from './schemas.js'

export type LinkRow = typeof cardLinks.$inferSelect

/**
 * How two cards relate (escopo-mvp 2.7), read from the card that "does" it: it blocks, duplicates,
 * delivers or causes the other. `delivers` is what joins a PRD opportunity to the TEC work that ships
 * it (Jira's "Polaris" link); `causes` is the incident link. `relates` reads the same both ways.
 */
export const linkTypeValues = ['relates', 'blocks', 'duplicates', 'delivers', 'causes'] as const
export const linkTypeSchema = z.enum(linkTypeValues)
export type LinkType = z.infer<typeof linkTypeSchema>

/** `outward`: this card does it to the other. `inward`: the other card does it to this one. */
export const linkDirectionSchema = z.enum(['outward', 'inward'])
export type LinkDirection = z.infer<typeof linkDirectionSchema>

/** Another card, as a line in a list of relations: enough to recognise it and see where it stands. */
export const cardRefSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  spaceId: z.uuid(),
  state: z.object({ name: z.string(), group: stateGroupSchema })
})
export type CardRef = z.infer<typeof cardRefSchema>

export const linkViewSchema = z.object({
  id: z.uuid(),
  type: linkTypeSchema,
  direction: linkDirectionSchema,
  card: cardRefSchema
})
export type LinkView = z.infer<typeof linkViewSchema>

/** Everything a card is tied to: its parent, its children (2.6) and its typed links (2.7). */
export const relationsViewSchema = z.object({
  parent: cardRefSchema.nullable(),
  children: z.array(cardRefSchema),
  links: z.array(linkViewSchema)
})
export type RelationsView = z.infer<typeof relationsViewSchema>

/** The other card, by id or by its key as people type it (`PRD-219`). */
export const createLinkSchema = z
  .object({
    type: linkTypeSchema,
    direction: linkDirectionSchema.default('outward'),
    cardId: z.uuid().optional(),
    key: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/)
      .optional()
  })
  .refine((input) => (input.cardId === undefined) !== (input.key === undefined), {
    message: 'Name the other card by cardId or by key, not both'
  })
export type CreateLink = z.infer<typeof createLinkSchema>

export const linkPathSchema = z.object({ cardId: z.uuid(), linkId: z.uuid() })
