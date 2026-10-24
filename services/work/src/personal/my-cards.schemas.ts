import { z } from 'zod'

import { cardRefSchema } from '../cards/link.schemas.js'
import { prioritySchema } from '../cards/schemas.js'

/**
 * The tabs of "Suas tarefas" on Para você:
 *
 * - `assigned` — open cards they are the assignee of;
 * - `starred` — cards they starred;
 * - `recommended` — what they can start now: cards of the active sprint of a space where they hold a
 *   role, not started yet, nobody else's, and not blocked by a card still open. Never the backlog.
 */
export const myCardTabValues = ['assigned', 'starred', 'recommended'] as const
export const myCardTabSchema = z.enum(myCardTabValues)
export type MyCardTab = z.infer<typeof myCardTabSchema>

export const myCardsQuerySchema = z.object({ tab: myCardTabSchema })

/** A card as a line of the list: what it is, where it stands, and when the tab last saw it. */
export const myCardSchema = cardRefSchema.extend({
  priority: prioritySchema,
  dueDate: z.iso.date().nullable(),
  assignee: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  at: z.iso.datetime()
})
export type MyCard = z.infer<typeof myCardSchema>
export const myCardListSchema = z.object({ items: z.array(myCardSchema) })

export const cardStarSchema = z.object({ starred: z.boolean() })
