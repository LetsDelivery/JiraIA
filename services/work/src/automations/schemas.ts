import { toIso } from '@jiraia/core'
import { z } from 'zod'

import { linkDirectionSchema, linkTypeSchema } from '../cards/link.schemas.js'
import { prioritySchema, stateGroupSchema } from '../cards/schemas.js'
import type { automationRuns, automations } from '../schema-intake.js'

/**
 * What an automation is made of (escopo-mvp 4.2): when → if → then. Each part is a closed list of
 * kinds, so the screen can draw every rule with selects and the engine knows every case.
 */

/** When it runs: a card of the space is created, changes state, or has a field changed. */
export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card_created') }),
  z.object({
    type: z.literal('state_changed'),
    /** Into this state; absent means any. */
    toStateId: z.uuid().optional(),
    /** Into any state of this group — "concluído" across states named differently. */
    toGroup: stateGroupSchema.optional()
  }),
  z.object({ type: z.literal('field_changed'), field: z.string().min(1).max(80) })
])
export type Trigger = z.infer<typeof triggerSchema>

/** If it goes on: every condition must hold on the card as it is after the change. */
export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('type_is'), typeIds: z.array(z.uuid()).min(1) }),
  z.object({ type: z.literal('label_has'), label: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('priority_is'), priorities: z.array(prioritySchema).min(1) })
])
export type Condition = z.infer<typeof conditionSchema>

/** A text with `{{card.key}}`-style blanks, filled when the action runs (`template.ts`). */
const templateSchema = z.string().max(5_000)

/** Then: done in order; what one action makes (a card) is what the next can use (`{{created.key}}`). */
export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_card'),
    spaceId: z.uuid(),
    typeId: z.uuid().optional(),
    stateId: z.uuid().optional(),
    title: templateSchema.default('{{card.title}}'),
    description: templateSchema.default('{{card.description}}'),
    /** How the new card is tied to the one that triggered: `inward` reads "the new card delivers it". */
    link: z.object({ type: linkTypeSchema, direction: linkDirectionSchema }).optional()
  }),
  z.object({ type: z.literal('set_state'), stateId: z.uuid() }),
  z.object({
    type: z.literal('move_linked'),
    /** The cards tied to this one by this link, in this space, go to `stateId`. */
    linkType: linkTypeSchema,
    direction: linkDirectionSchema,
    spaceId: z.uuid(),
    stateId: z.uuid(),
    /** Left on each card moved; empty leaves none. */
    comment: templateSchema.default('')
  }),
  z.object({ type: z.literal('comment'), body: templateSchema.min(1) }),
  z.object({ type: z.literal('slack'), channelId: z.uuid(), text: templateSchema.min(1) })
])
export type Action = z.infer<typeof actionSchema>

export const automationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10)
})
export type AutomationInput = z.infer<typeof automationInputSchema>

export const automationViewSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  owner: z.object({ id: z.uuid(), name: z.string() }),
  name: z.string(),
  enabled: z.boolean(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema),
  actions: z.array(actionSchema),
  updatedAt: z.iso.datetime()
})
export type AutomationView = z.infer<typeof automationViewSchema>
export const automationListSchema = z.object({ items: z.array(automationViewSchema) })

export const runStatusSchema = z.enum(['succeeded', 'failed', 'skipped'])
/** What one action did: its kind and the key or channel it touched. The screen words it in pt-BR. */
export const runStepSchema = z.object({ action: z.string(), detail: z.string() })
export type RunStep = z.infer<typeof runStepSchema>
export const runViewSchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  status: runStatusSchema,
  steps: z.array(runStepSchema),
  error: z.string().nullable(),
  durationMs: z.number().int(),
  occurredAt: z.iso.datetime()
})
export type RunView = z.infer<typeof runViewSchema>
export const runListSchema = z.object({ items: z.array(runViewSchema) })

export const automationPathSchema = z.object({ automationId: z.uuid() })

export type AutomationRow = typeof automations.$inferSelect
export type RunRow = typeof automationRuns.$inferSelect

export const toAutomationView = (row: AutomationRow, ownerName: string): AutomationView => ({
  id: row.id,
  spaceId: row.spaceId,
  owner: { id: row.ownerId, name: ownerName },
  name: row.name,
  enabled: row.enabled,
  trigger: triggerSchema.parse(row.trigger),
  conditions: z.array(conditionSchema).parse(row.conditions),
  actions: z.array(actionSchema).parse(row.actions),
  updatedAt: toIso(row.updatedAt)
})

export const toRunView = (row: RunRow): RunView => ({
  id: row.id,
  cardId: row.cardId,
  status: runStatusSchema.parse(row.status),
  steps: z.array(runStepSchema).parse(row.steps),
  error: row.error,
  durationMs: row.durationMs,
  occurredAt: toIso(row.occurredAt)
})
