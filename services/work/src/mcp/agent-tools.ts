import { z } from 'zod'

import type { CardService } from '../cards/card.service.js'
import { createLinkSchema } from '../cards/link.schemas.js'
import { createCardSchema, updateCardSchema } from '../cards/schemas.js'
import type { ProposalService } from '../proposals/proposal.service.js'
import type { ProposalItemInput, ProposalView } from '../proposals/schemas.js'
import { type ReadDeps, spaceByKey } from './read-tools.js'
import { cardKeySchema, defineTool, spaceKeySchema, type Tool, type ToolContext } from './tool.js'

type WriteDeps = ReadDeps & { cards: CardService; proposals: ProposalService }

const commentBody = z.string().trim().min(1).max(20_000)
const reasonSchema = z.string().trim().min(1).max(2_000).describe('Why — the first thing the approver reads')

/** An item as an agent names it: cards by key. The tool turns keys into the ids a proposal keeps. */
const keyedItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_card'), card: createCardSchema }),
  z.object({ kind: z.literal('update_card'), card: cardKeySchema, changes: updateCardSchema }),
  z.object({ kind: z.literal('comment'), card: cardKeySchema, body: commentBody }),
  z.object({ kind: z.literal('link'), card: cardKeySchema, link: createLinkSchema })
])
type KeyedItem = z.infer<typeof keyedItemSchema>

const toItem = async (deps: WriteDeps, item: KeyedItem, { caller }: ToolContext): Promise<ProposalItemInput> => {
  if (item.kind === 'create_card') {
    return item
  }
  const { card, ...rest } = item
  return { ...rest, cardId: (await deps.cards.readByKey(caller, card)).id } as ProposalItemInput
}

/** What the agent needs back: where the proposal stands, and what to do next. */
const outcome = (proposal: ProposalView) => ({
  proposalId: proposal.id,
  status: proposal.status,
  autoApplied: proposal.autoApplied,
  items: proposal.items.map((item) => ({ kind: item.kind, status: item.status, card: item.card?.key ?? null })),
  next:
    proposal.status === 'applied'
      ? 'The space applies this kind of change on arrival; it is done.'
      : 'A person who writes the space will approve, adjust or reject it. Call get_proposal later to read the decision.'
})

const propose = async (deps: WriteDeps, context: ToolContext, spaceId: string, reason: string, items: KeyedItem[]) => {
  const inputs = await Promise.all(items.map((item) => toItem(deps, item, context)))
  return outcome(await deps.proposals.propose(context.caller, spaceId, { reason, items: inputs }))
}

/**
 * What an autonomous agent — a service account — writes with (ADR-0019, ADR-0022): every change is a
 * proposal a person decides, unless the space lets that kind apply on arrival.
 */
export const agentTools = (deps: WriteDeps): Tool[] => [
  defineTool({
    name: 'propose_changes',
    title: 'Propose changes',
    description:
      'Ask for changes in one space — new cards, field or state changes, comments, links — with one reason. Nothing changes until a person approves; each item may be approved, adjusted or declined.',
    input: z.object({ space: spaceKeySchema, reason: reasonSchema, items: z.array(keyedItemSchema).min(1).max(50) }),
    audience: 'agent',
    writes: true,
    run: async ({ space, reason, items }, context) =>
      await propose(deps, context, (await spaceByKey(deps, space, context)).id, reason, items)
  }),
  defineTool({
    name: 'withdraw_proposal',
    title: 'Withdraw a proposal',
    description: 'Take back one of your pending proposals.',
    input: z.object({ proposalId: z.uuid() }),
    audience: 'agent',
    writes: true,
    run: async ({ proposalId }, { caller }) => outcome(await deps.proposals.withdraw(caller, proposalId))
  })
]
