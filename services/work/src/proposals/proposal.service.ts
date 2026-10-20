import {
  type Clock,
  ConflictException,
  ForbiddenException,
  type IdGenerator,
  NotFoundException,
  ValidationException
} from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import type { JiraiaLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import type { AuditTrail, Changes } from '../audit/audit.js'
import type { CardRepository } from '../cards/card.repository.js'
import type { CardGate } from '../cards/card-gate.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import { currentValues, drifted, type FieldValues, itemCardId } from './item-effects.js'
import type { ProposalRepository, ProposalWithItems } from './proposal.repository.js'
import type { Approved, Outcome, ProposalApplier } from './proposal-applier.js'
import { type ProposalViews, statusOf } from './proposal-views.js'
import {
  type ApproveProposal,
  type CreateProposal,
  type ListProposals,
  type ProposalItemInput,
  type ProposalItemRow,
  type ProposalPolicy,
  type ProposalRow,
  type ProposalStatus,
  type ProposalView,
  proposalPolicySchema
} from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  gate: SpaceGate
  cardGate: CardGate
  cards: CardRepository
  members: MemberRepository
  proposals: ProposalRepository
  applier: ProposalApplier
  views: ProposalViews
  logger: JiraiaLogger
}

/** A pending proposal waits this long for a person; after it, it reads as expired (ADR-0019). */
export const PROPOSAL_DAYS = 14
const DAY_MS = 86_400_000

/**
 * Proposals (escopo-mvp 6.2, ADR-0019): an agent asks, a person who writes the space approves — all or
 * some, adjusted or as asked — or rejects; an applied proposal can be reverted. A space may let some
 * kinds apply as they arrive.
 */
export class ProposalService {
  constructor(private readonly deps: Deps) {}

  async propose(caller: Caller, spaceId: string, input: CreateProposal): Promise<ProposalView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:read')
    if (gate.actor.kind !== 'agent') {
      throw new ForbiddenException('Only an agent proposes; a person makes the change directly', { spaceId })
    }
    const row = this._newProposal(gate)
    const items = await this._newItems(gate, row.id, input.items)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.proposals.insert(tx, { ...row, reason: input.reason }, items)
      await this._audit(tx, gate.actor, row, 'proposed', {
        reason: { before: null, after: input.reason },
        items: { before: null, after: items.length }
      })
    })
    await this._autoApply(gate, row.id)
    return await this._view(gate.actor, row.id)
  }

  async read(caller: Caller, proposalId: string): Promise<ProposalView> {
    const { actor, proposal } = await this._open(caller, proposalId, 'space:read')
    return (await this.deps.views.build(actor, [proposal]))[0] as ProposalView
  }

  /**
   * An agent lists what it proposed. A person lists, pending, what they may decide; decided, what was
   * decided in the spaces they read — everyone reads every space.
   */
  async list(caller: Caller, query: ListProposals): Promise<{ items: ProposalView[] }> {
    const actor = await this.deps.access.actor(caller)
    const rows = await this.deps.proposals.list(actor.organizationId, {
      open: query.status === 'pending',
      spaceId: query.spaceId,
      authorId: actor.kind === 'agent' ? actor.id : undefined
    })
    const views = await this.deps.views.build(actor, rows)
    const shown = actor.kind === 'agent' || query.status === 'decided' ? views : views.filter((view) => view.canDecide)
    return { items: query.status === 'pending' ? shown.filter((view) => view.status === 'pending') : shown }
  }

  async pendingCount(caller: Caller): Promise<{ pending: number }> {
    return { pending: (await this.list(caller, { status: 'pending' })).items.length }
  }

  /** Pending proposals about this card — the strip on its detail. */
  async forCard(caller: Caller, cardId: string): Promise<{ items: ProposalView[] }> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const views = await this.deps.views.build(gate.actor, await this.deps.proposals.pendingForCard(card.id))
    return { items: views.filter((view) => view.status === 'pending') }
  }

  async approve(caller: Caller, proposalId: string, input: ApproveProposal): Promise<ProposalView> {
    const { actor, proposal } = await this._decidable(caller, proposalId)
    const approved = this._approvedItems(proposal, input)
    await this._assertFresh(proposal, approved, input.acknowledgeConflicts)
    await this._claim(proposal, 'pending', 'applying')
    const outcomes = await this._run(proposal, approved)
    await this._settle(actor, proposal, approved, outcomes, input.note)
    return await this._view(actor, proposal.id)
  }

  async reject(caller: Caller, proposalId: string, note: string): Promise<ProposalView> {
    const { actor, proposal } = await this._decidable(caller, proposalId)
    await this._close(actor, proposal, 'rejected', { note, decidedBy: actor.id, decidedAt: this.deps.clock.now() })
    return await this._view(actor, proposal.id)
  }

  /** The agent takes back its own pending proposal. */
  async withdraw(caller: Caller, proposalId: string): Promise<ProposalView> {
    const { actor, proposal } = await this._open(caller, proposalId, 'space:read')
    if (proposal.authorId !== actor.id) {
      throw new ForbiddenException(`Only its agent withdraws proposal "${proposalId}"`, { proposalId })
    }
    this._assertPending(proposal)
    await this._close(actor, proposal, 'withdrawn', {})
    return await this._view(actor, proposal.id)
  }

  async revert(caller: Caller, proposalId: string): Promise<ProposalView> {
    const { actor, proposal } = await this._open(caller, proposalId, 'space:write')
    this._assertPerson(actor)
    if (proposal.status !== 'applied') {
      throw new ConflictException(`Proposal "${proposalId}" is ${statusOf(proposal, this.deps.clock.now())}`, {
        proposalId
      })
    }
    const now = this.deps.clock.now()
    await this._claim(proposal, 'applied', 'reverted', { revertedBy: actor.id, revertedAt: now })
    await this._revertItems(caller, proposal)
    await this.deps.db.transaction(async (tx) => {
      await this._audit(tx, actor, proposal, 'reverted', { status: { before: 'applied', after: 'reverted' } })
    })
    return await this._view(actor, proposal.id)
  }

  async policy(caller: Caller, spaceId: string): Promise<ProposalPolicy> {
    await this.deps.gate.check(caller, spaceId, 'space:read')
    return proposalPolicySchema.parse({ autoApply: (await this.deps.proposals.policy(spaceId))?.autoApply ?? [] })
  }

  /** A space admin chooses which kinds agents apply without approval. */
  async setPolicy(caller: Caller, spaceId: string, input: ProposalPolicy): Promise<ProposalPolicy> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const before = (await this.policy(caller, spaceId)).autoApply
    const autoApply = [...new Set(input.autoApply)]
    await this.deps.db.transaction(async (tx) => {
      const row = { spaceId, autoApply, updatedBy: gate.actor.id, updatedAt: this.deps.clock.now() }
      await this.deps.proposals.putPolicy(tx, row)
      await this.deps.audit.record(tx, {
        organizationId: gate.actor.organizationId,
        spaceId,
        actorId: gate.actor.id,
        entityType: 'proposal_policy',
        entityId: spaceId,
        action: 'updated',
        changes: { autoApply: { before, after: autoApply } }
      })
    })
    return { autoApply }
  }

  private _newProposal(gate: Gate): ProposalRow {
    const now = this.deps.clock.now()
    return {
      id: this.deps.ids.next(),
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      authorId: gate.actor.id,
      reason: '',
      status: 'pending',
      autoApplied: false,
      decidedBy: null,
      decidedAt: null,
      note: '',
      revertedBy: null,
      revertedAt: null,
      expiresAt: new Date(now.getTime() + PROPOSAL_DAYS * DAY_MS),
      createdAt: now,
      updatedAt: now
    }
  }

  /** Each item's card must be one of the space's; a field change keeps what the agent saw as its base. */
  private async _newItems(gate: Gate, proposalId: string, inputs: readonly ProposalItemInput[]) {
    const rows: ProposalItemRow[] = []
    for (const [position, input] of inputs.entries()) {
      const cardId = itemCardId(input)
      const card = cardId ? await this._cardOfSpace(gate, cardId) : undefined
      rows.push({
        id: this.deps.ids.next(),
        proposalId,
        position,
        kind: input.kind,
        cardId,
        payload: input,
        adjusted: null,
        base: card && input.kind === 'update_card' ? currentValues(card, input.changes) : {},
        status: 'pending',
        result: null,
        error: null
      })
    }
    return rows
  }

  private async _cardOfSpace(gate: Gate, cardId: string) {
    const card = await this.deps.cards.find(gate.actor.organizationId, cardId)
    if (card?.spaceId !== gate.space.id) {
      throw new ValidationException(`Card "${cardId}" is not a card of space "${gate.space.key}"`, { cardId })
    }
    return card
  }

  /** A proposal and its space as the caller may see them: 404 when the space is not theirs to read. */
  private async _open(caller: Caller, proposalId: string, action: 'space:read' | 'space:write') {
    const actor = await this.deps.access.actor(caller)
    const proposal = await this.deps.proposals.find(actor.organizationId, proposalId)
    if (!proposal) {
      throw new NotFoundException('Proposal', proposalId)
    }
    const gate =
      action === 'space:write'
        ? await this.deps.gate.checkWritable(caller, proposal.spaceId, action)
        : await this.deps.gate.check(caller, proposal.spaceId, action)
    return { actor: gate.actor, proposal }
  }

  /** Approving and rejecting are a person's, who writes the space, while the proposal is pending. */
  private async _decidable(caller: Caller, proposalId: string) {
    const opened = await this._open(caller, proposalId, 'space:write')
    this._assertPerson(opened.actor)
    this._assertPending(opened.proposal)
    return opened
  }

  private _assertPerson(actor: MemberRow): void {
    if (actor.kind !== 'person') {
      throw new ForbiddenException('Only a person decides on a proposal', { memberId: actor.id })
    }
  }

  private _assertPending(proposal: ProposalWithItems): void {
    const status = statusOf(proposal, this.deps.clock.now())
    if (status !== 'pending') {
      throw new ConflictException(`Proposal "${proposal.id}" is ${status}`, { proposalId: proposal.id })
    }
  }

  /** The items chosen — all when none are named — each with the approver's adjustment when there is one. */
  private _approvedItems(proposal: ProposalWithItems, input: ApproveProposal): Approved[] {
    const chosen = new Set(input.itemIds ?? proposal.items.map((item) => item.id))
    const unknown = [...chosen, ...input.adjustments.map((each) => each.itemId)].find(
      (id) => !proposal.items.some((item) => item.id === id)
    )
    if (unknown) {
      throw new ValidationException(`Item "${unknown}" is not part of proposal "${proposal.id}"`, { itemId: unknown })
    }
    return proposal.items
      .filter((row) => chosen.has(row.id))
      .map((row) => ({ row, input: _adjusted(row, input.adjustments.find((each) => each.itemId === row.id)?.item) }))
  }

  /** A field change whose card moved on since it was proposed needs the approver's say-so. */
  private async _assertFresh(proposal: ProposalWithItems, approved: readonly Approved[], acknowledged: boolean) {
    const stale = acknowledged ? [] : (await Promise.all(approved.map((each) => this._stale(proposal, each)))).flat()
    if (stale.length > 0) {
      throw new ConflictException(`The card changed since the proposal: ${stale.join(', ')}`, {
        proposalId: proposal.id,
        stale: stale.join('; ')
      })
    }
  }

  /** `REQ-4 title` for each field of a field change whose card no longer holds the base. */
  private async _stale(proposal: ProposalRow, { row, input }: Approved): Promise<string[]> {
    if (input.kind !== 'update_card') {
      return []
    }
    const card = await this.deps.cards.find(proposal.organizationId, input.cardId)
    const changed = card ? drifted(row.base as FieldValues, currentValues(card, input.changes)) : {}
    return Object.keys(changed).map((field) => `${card?.spaceKey}-${card?.number} ${field}`)
  }

  private async _claim(proposal: ProposalRow, from: ProposalStatus, to: ProposalStatus, fields = {}) {
    const moved = await this.deps.proposals.transition(proposal.id, from, {
      status: to,
      updatedAt: this.deps.clock.now(),
      ...fields
    })
    if (!moved) {
      throw new ConflictException(`Proposal "${proposal.id}" was decided by someone else`, { proposalId: proposal.id })
    }
  }

  /** Runs the items as the agent; anything but an item's own failure puts the proposal back to pending. */
  private async _run(proposal: ProposalWithItems, approved: readonly Approved[]): Promise<Outcome[]> {
    try {
      const agent = await this.deps.members.findById(proposal.organizationId, proposal.authorId)
      if (agent?.status !== 'active') {
        throw new ConflictException(`The agent of proposal "${proposal.id}" is no longer active`, {
          proposalId: proposal.id
        })
      }
      for (const { row, input } of approved) {
        // `_adjusted` hands back the stored payload itself when nothing was adjusted.
        if (input !== row.payload) {
          await this.deps.proposals.updateItem(row.id, { adjusted: input })
        }
      }
      return await this._appliedOrBack(proposal, approved, agent)
    } catch (error) {
      await this.deps.proposals.transition(proposal.id, 'applying', { status: 'pending' })
      throw error
    }
  }

  /** When no item goes through, nothing changed: the first error is the answer. */
  private async _appliedOrBack(proposal: ProposalRow, approved: readonly Approved[], agent: MemberRow) {
    const outcomes = await this.deps.applier.apply(proposal, approved, agent)
    const failed = outcomes.filter((outcome) => !outcome.ok)
    if (failed.length === outcomes.length) {
      const first = failed[0] as Extract<Outcome, { ok: false }>
      throw new ConflictException(`No change of proposal "${proposal.id}" could be applied: ${first.error}`, {
        proposalId: proposal.id
      })
    }
    return outcomes
  }

  /** Each item's fate, then the proposal's: applied, by whom, with the note. */
  private async _settle(
    actor: MemberRow | null,
    proposal: ProposalWithItems,
    approved: readonly Approved[],
    outcomes: readonly Outcome[],
    note: string
  ) {
    for (const item of proposal.items) {
      await this.deps.proposals.updateItem(item.id, _fate(item, approved, outcomes))
    }
    const now = this.deps.clock.now()
    const applied = outcomes.filter((outcome) => outcome.ok).length
    await this.deps.db.transaction(async (tx) => {
      await this.deps.proposals.update(tx, proposal.id, {
        status: 'applied',
        autoApplied: actor === null,
        decidedBy: actor?.id ?? null,
        decidedAt: now,
        note,
        updatedAt: now
      })
      await this._audit(
        tx,
        actor ?? { id: proposal.authorId, organizationId: proposal.organizationId },
        proposal,
        'approved',
        {
          applied: { before: null, after: applied },
          failed: { before: null, after: outcomes.length - applied },
          declined: { before: null, after: proposal.items.length - approved.length }
        }
      )
    })
  }

  private async _close(
    actor: MemberRow,
    proposal: ProposalWithItems,
    status: 'rejected' | 'withdrawn',
    fields: object
  ) {
    await this._claim(proposal, 'pending', status, fields)
    for (const item of proposal.items) {
      await this.deps.proposals.updateItem(item.id, { status: 'declined' })
    }
    await this.deps.db.transaction(async (tx) => {
      const note = 'note' in fields ? { note: { before: null, after: fields.note } } : {}
      await this._audit(tx, actor, proposal, status, { status: { before: 'pending', after: status }, ...note })
    })
  }

  private async _revertItems(caller: Caller, proposal: ProposalWithItems): Promise<void> {
    try {
      await this.deps.applier.revert(caller, proposal, proposal.items)
    } catch (error) {
      await this.deps.proposals.transition(proposal.id, 'reverted', {
        status: 'applied',
        revertedBy: null,
        revertedAt: null
      })
      throw error
    }
    for (const item of proposal.items.filter((each) => each.status === 'applied')) {
      await this.deps.proposals.updateItem(item.id, { status: 'reverted' })
    }
  }

  /**
   * A proposal whose every item is of a kind the space lets agents apply goes through as it arrives. If
   * nothing can be applied it simply stays pending, for a person to look at.
   */
  private async _autoApply(gate: Gate, proposalId: string): Promise<void> {
    const allowed = new Set((await this.deps.proposals.policy(gate.space.id))?.autoApply as string[] | undefined)
    const proposal = await this.deps.proposals.find(gate.actor.organizationId, proposalId)
    if (!proposal?.items.every((item) => allowed.has(item.kind))) {
      return
    }
    const approved = proposal.items.map((row) => ({ row, input: _adjusted(row, undefined) }))
    try {
      await this._claim(proposal, 'pending', 'applying')
      const outcomes = await this._run(proposal, approved)
      await this._settle(null, proposal, approved, outcomes, '')
    } catch (error) {
      this.deps.logger.warn('Proposal left pending: it could not be applied automatically', { proposalId, error })
    }
  }

  private async _view(actor: MemberRow, proposalId: string): Promise<ProposalView> {
    const proposal = await this.deps.proposals.find(actor.organizationId, proposalId)
    if (!proposal) {
      throw new NotFoundException('Proposal', proposalId)
    }
    return (await this.deps.views.build(actor, [proposal]))[0] as ProposalView
  }

  private async _audit(
    tx: Database,
    actor: Pick<MemberRow, 'id' | 'organizationId'>,
    proposal: ProposalRow,
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: proposal.spaceId,
      actorId: actor.id,
      entityType: 'proposal',
      entityId: proposal.id,
      action,
      changes
    })
  }
}

/** The input that wins: the approver's adjustment — same kind, same card — or what was proposed. */
const _adjusted = (row: ProposalItemRow, adjustment: ProposalItemInput | undefined): ProposalItemInput => {
  const proposed = row.payload as ProposalItemInput
  if (!adjustment) {
    return proposed
  }
  if (adjustment.kind !== proposed.kind || itemCardId(adjustment) !== itemCardId(proposed)) {
    throw new ValidationException(`An adjustment keeps the kind and the card of item "${row.id}"`, { itemId: row.id })
  }
  return adjustment
}

const _fate = (item: ProposalItemRow, approved: readonly Approved[], outcomes: readonly Outcome[]) => {
  const outcome = outcomes.find((each) => each.itemId === item.id)
  if (!approved.some((each) => each.row.id === item.id) || !outcome) {
    return { status: 'declined' }
  }
  return outcome.ok
    ? { status: 'applied', result: outcome.result, error: null }
    : { status: 'failed', error: outcome.error }
}
