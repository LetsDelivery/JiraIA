import { z } from 'zod'

import { createLinkSchema } from '../cards/link.schemas.js'
import { createCardSchema, updateCardSchema } from '../cards/schemas.js'
import type { proposalItems, proposalPolicies, proposals } from '../schema-agents.js'

export type ProposalRow = typeof proposals.$inferSelect
export type ProposalItemRow = typeof proposalItems.$inferSelect
export type ProposalPolicyRow = typeof proposalPolicies.$inferSelect

/** What an agent may propose (ADR-0019): a new card, field changes, a comment, a link. */
export const itemKindValues = ['create_card', 'update_card', 'comment', 'link'] as const
export const itemKindSchema = z.enum(itemKindValues)
export type ItemKind = z.infer<typeof itemKindSchema>

/** One change, as the agent sends it and as an approver adjusts it. */
export const proposalItemInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_card'), card: createCardSchema }),
  z.object({ kind: z.literal('update_card'), cardId: z.uuid(), changes: updateCardSchema }),
  z.object({ kind: z.literal('comment'), cardId: z.uuid(), body: z.string().trim().min(1).max(20_000) }),
  z.object({ kind: z.literal('link'), cardId: z.uuid(), link: createLinkSchema })
])
export type ProposalItemInput = z.infer<typeof proposalItemInputSchema>

export const createProposalSchema = z.object({
  /** Why the agent wants it — what the approver reads first. */
  reason: z.string().trim().min(1).max(2_000),
  items: z.array(proposalItemInputSchema).min(1).max(50)
})
export type CreateProposal = z.infer<typeof createProposalSchema>

/** Stored statuses; `expired` is how a pending one past its date reads. */
export const proposalStatusValues = ['pending', 'applying', 'applied', 'rejected', 'withdrawn', 'reverted'] as const
export type ProposalStatus = (typeof proposalStatusValues)[number]
export const proposalStatusViewSchema = z.enum(['pending', 'applied', 'rejected', 'withdrawn', 'reverted', 'expired'])
export type ProposalStatusView = z.infer<typeof proposalStatusViewSchema>

export const itemStatusSchema = z.enum(['pending', 'applied', 'failed', 'declined', 'reverted'])
export type ItemStatus = z.infer<typeof itemStatusSchema>

/**
 * The approval: every item unless `itemIds` names some (the rest are declined), with the values an
 * approver changed, and the consent to apply items whose card moved on since they were proposed.
 */
export const approveProposalSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).optional(),
  adjustments: z
    .array(z.object({ itemId: z.uuid(), item: proposalItemInputSchema }))
    .max(50)
    .default([]),
  acknowledgeConflicts: z.boolean().default(false),
  note: z.string().trim().max(2_000).default('')
})
export type ApproveProposal = z.infer<typeof approveProposalSchema>

export const rejectProposalSchema = z.object({ note: z.string().trim().max(2_000).default('') })

const personSchema = z.object({ id: z.uuid(), name: z.string() })
const changesSchema = z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() }))

export const proposalItemViewSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  kind: itemKindSchema,
  status: itemStatusSchema,
  /** The card the item is about: the one it changes, or the one it created once applied. */
  card: z.object({ id: z.uuid(), key: z.string(), title: z.string() }).nullable(),
  proposed: proposalItemInputSchema,
  adjusted: proposalItemInputSchema.nullable(),
  /** What applying does (or did), field by field, from the base the agent saw. */
  changes: changesSchema,
  /** Fields whose value on the card is no longer the one the agent saw — `before` is the base. */
  conflicts: changesSchema,
  error: z.string().nullable()
})
export type ProposalItemView = z.infer<typeof proposalItemViewSchema>

export const proposalViewSchema = z.object({
  id: z.uuid(),
  space: z.object({ id: z.uuid(), key: z.string(), name: z.string() }),
  author: personSchema,
  reason: z.string(),
  status: proposalStatusViewSchema,
  autoApplied: z.boolean(),
  decidedBy: personSchema.nullable(),
  decidedAt: z.iso.datetime().nullable(),
  note: z.string(),
  revertedBy: personSchema.nullable(),
  revertedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  items: z.array(proposalItemViewSchema),
  /** Names for the ids in `changes` — states, types, people, groups, custom fields — as the screen shows them. */
  names: z.record(z.string(), z.string()),
  /** Whether the caller may approve or reject it now; `canRevert`, undo it. */
  canDecide: z.boolean(),
  canRevert: z.boolean()
})
export type ProposalView = z.infer<typeof proposalViewSchema>
export const proposalListSchema = z.object({ items: z.array(proposalViewSchema) })

export const listProposalsQuerySchema = z.object({
  status: z.enum(['pending', 'decided']).default('pending'),
  spaceId: z.uuid().optional()
})
export type ListProposals = z.infer<typeof listProposalsQuerySchema>

export const pendingCountSchema = z.object({ pending: z.number().int() })
export const proposalPathSchema = z.object({ proposalId: z.uuid() })

export const proposalPolicySchema = z.object({ autoApply: z.array(itemKindSchema) })
export type ProposalPolicy = z.infer<typeof proposalPolicySchema>
