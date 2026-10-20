import { ConflictException, NotFoundException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { CardRepository } from '../cards/card.repository.js'
import type { CardService } from '../cards/card.service.js'
import type { CommentService } from '../cards/comment.service.js'
import type { LinkService } from '../cards/link.service.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import type { MemberRow } from '../members/schemas.js'
import { underProposal } from './delegation.js'
import { currentValues, drifted, type FieldValues, intendedValues, toUpdate } from './item-effects.js'
import type { ProposalItemInput, ProposalItemRow, ProposalRow } from './schemas.js'

type Deps = {
  cards: CardService
  comments: CommentService
  links: LinkService
  cardRows: CardRepository
  workflows: WorkflowRepository
}

/**
 * What applying made — the card, the comment or the link — and, for a field change, the values it wrote
 * over and the ones it wrote: what revert needs to find and to check.
 */
export type ItemResult = {
  cardId: string
  commentId?: string
  linkId?: string
  previous?: FieldValues
  applied?: FieldValues
}

export type Outcome = { itemId: string } & ({ ok: true; result: ItemResult } | { ok: false; error: string })

/** An item to apply: its row and the input that wins — the approver's adjustment, or what was proposed. */
export type Approved = { row: ProposalItemRow; input: ProposalItemInput }

/**
 * Runs a proposal's items through the same services a person's change goes through (ADR-0019). Applying
 * runs as the agent, which borrows the member role on the proposal's space for that call only;
 * reverting runs as the person who asks.
 */
export class ProposalApplier {
  constructor(private readonly deps: Deps) {}

  /** One item at a time, in order; a failure is that item's outcome and the next one still runs. */
  async apply(proposal: ProposalRow, items: readonly Approved[], agent: MemberRow): Promise<Outcome[]> {
    const caller: Caller = { subject: `proposal:${proposal.id}`, emailVerified: false, memberId: agent.id }
    const scope = { proposalId: proposal.id, spaceId: proposal.spaceId, agentId: agent.id }
    return await underProposal(scope, async () => {
      const outcomes: Outcome[] = []
      for (const item of items) {
        outcomes.push(await this._attempt(item.row.id, () => this._applyOne(caller, proposal, item.input, agent)))
      }
      return outcomes
    })
  }

  /**
   * Newest first. Every field change is checked before anything is undone, so a card someone changed
   * since stops the revert whole rather than halfway.
   */
  async revert(caller: Caller, proposal: ProposalRow, items: readonly ProposalItemRow[]): Promise<void> {
    const applied = items.filter((item) => item.status === 'applied').reverse()
    for (const item of applied) {
      await this._assertUntouched(proposal, item)
    }
    await underProposal({ proposalId: proposal.id, spaceId: proposal.spaceId }, async () => {
      for (const item of applied) {
        await this._revertOne(caller, proposal, item)
      }
    })
  }

  private async _attempt(itemId: string, work: () => Promise<ItemResult>): Promise<Outcome> {
    try {
      return { itemId, ok: true, result: await work() }
    } catch (error) {
      return { itemId, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async _applyOne(caller: Caller, proposal: ProposalRow, input: ProposalItemInput, agent: MemberRow) {
    switch (input.kind) {
      case 'create_card':
        return { cardId: (await this.deps.cards.create(caller, proposal.spaceId, input.card)).id }
      case 'update_card':
        return await this._update(caller, proposal, input)
      case 'comment':
        return { cardId: input.cardId, commentId: await this._comment(caller, input.cardId, input.body, agent) }
      case 'link':
        return { cardId: input.cardId, linkId: await this._link(caller, input) }
    }
  }

  private async _update(
    caller: Caller,
    proposal: ProposalRow,
    input: Extract<ProposalItemInput, { kind: 'update_card' }>
  ) {
    const card = await this.deps.cardRows.find(proposal.organizationId, input.cardId)
    const previous = card ? currentValues(card, input.changes) : {}
    await this.deps.cards.update(caller, input.cardId, input.changes)
    return { cardId: input.cardId, previous, applied: intendedValues(input.changes) }
  }

  /** The comment the agent just wrote: its newest on the card. */
  private async _comment(caller: Caller, cardId: string, body: string, agent: MemberRow): Promise<string> {
    const { items } = await this.deps.comments.create(caller, cardId, body)
    const mine = items.filter((comment) => comment.author.id === agent.id)
    return (mine.at(-1) as (typeof mine)[number]).id
  }

  private async _link(caller: Caller, input: Extract<ProposalItemInput, { kind: 'link' }>): Promise<string> {
    const { links } = await this.deps.links.link(caller, input.cardId, input.link)
    const other = input.link.cardId ?? input.link.key?.toUpperCase()
    const made = links.find(
      (link) =>
        link.type === input.link.type &&
        link.direction === input.link.direction &&
        (link.card.id === other || link.card.key === other)
    )
    return (made as NonNullable<typeof made>).id
  }

  private async _assertUntouched(proposal: ProposalRow, item: ProposalItemRow): Promise<void> {
    const result = item.result as ItemResult
    if (item.kind === 'create_card') {
      await this._cancelledState(proposal, result.cardId)
    }
    if (item.kind !== 'update_card' || !result.applied) {
      return
    }
    const card = await this.deps.cardRows.find(proposal.organizationId, result.cardId)
    if (!card) {
      throw new NotFoundException('Card', result.cardId)
    }
    const changed = Object.keys(drifted(result.applied, currentValues(card, toUpdate(result.applied))))
    if (changed.length > 0) {
      throw new ConflictException(
        `Card "${card.spaceKey}-${card.number}" changed after the proposal (${changed.join(', ')}); revert it by hand`,
        { cardId: card.id, fields: changed.join(',') }
      )
    }
  }

  private async _revertOne(caller: Caller, proposal: ProposalRow, item: ProposalItemRow): Promise<void> {
    const result = item.result as ItemResult
    switch (item.kind) {
      case 'create_card':
        return await this._cancel(caller, proposal, result.cardId)
      case 'update_card':
        await this.deps.cards.update(caller, result.cardId, toUpdate(result.previous ?? (item.base as FieldValues)))
        return
      case 'comment':
        return await this.deps.comments.retract(caller, result.cardId, result.commentId ?? '', proposal.authorId)
      case 'link':
        await this.deps.links.unlink(caller, result.cardId, result.linkId ?? '')
    }
  }

  /** Cards are never deleted: a card a proposal created goes to its space's first cancelled state. */
  private async _cancel(caller: Caller, proposal: ProposalRow, cardId: string): Promise<void> {
    await this.deps.cards.update(caller, cardId, { stateId: await this._cancelledState(proposal, cardId) })
  }

  private async _cancelledState(proposal: ProposalRow, cardId: string): Promise<string> {
    const card = await this.deps.cardRows.find(proposal.organizationId, cardId)
    const states = card ? await this.deps.workflows.states(card.spaceId) : []
    const cancelled = states.find((state) => state.group === 'cancelled')
    if (!card || !cancelled) {
      throw new ConflictException(
        `Card "${card ? `${card.spaceKey}-${card.number}` : cardId}" has no cancelled state to go to; add one to its workflow`,
        { cardId, missing: 'cancelled_state' }
      )
    }
    return cancelled.id
  }
}
