import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditEventView, type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { MemberRow } from '../members/schemas.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import type { CardFields, CardRepository } from './card.repository.js'
import type { CardAccess, CardGate } from './card-gate.js'
import { type CardRules, fieldChanges } from './card-rules.js'
import { rankAt } from './ranking.js'
import {
  type CardRow,
  type CardView,
  type CreateCard,
  type MoveCard,
  type TransferCard,
  toCardView,
  type UpdateCard
} from './schemas.js'
import type { WatcherRepository } from './watcher.repository.js'
import type { WorkflowRepository } from './workflow.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  cardGate: CardGate
  rules: CardRules
  cards: CardRepository
  workflows: WorkflowRepository
  watchers: WatcherRepository
}

/** Cards — the work itself (escopo-mvp 2.1–2.14, 3.1, 3.3). Every write leaves the card's history. */
export class CardService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string, sprint?: string): Promise<{ items: CardView[] }> {
    await this.deps.gate.check(caller, spaceId, 'space:read')
    const rows = await this.deps.cards.list(spaceId)
    const sprintId = sprint === 'active' ? ((await this.deps.rules.activeSprint(spaceId)) ?? '') : sprint
    const wanted = sprintId === undefined ? rows : rows.filter((row) => (row.sprintId ?? 'none') === sprintId)
    return { items: wanted.map(toCardView) }
  }

  /** Lands at the bottom of its state's column and of the backlog, numbered from the space's counter. */
  async create(caller: Caller, spaceId: string, input: CreateCard): Promise<CardView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:write')
    await this._assertPeopleAndParent(gate, input)
    if (input.sprintId) {
      await this.deps.rules.assertSprint(gate.actor, spaceId, input.sprintId)
    }
    return await this._insert(gate, input, {})
  }

  /**
   * A card sent through an intake form (escopo-mvp 4.1). The form, not a role, lets its sender create
   * it — a reader of the space may — and they are its reporter. The space must still accept writes.
   */
  async createFromForm(caller: Caller, spaceId: string, input: CreateCard, extra: FormExtra): Promise<CardView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:read')
    const customFields = Object.keys(extra.customFields).length
      ? await this.deps.rules.customFields(
          gate.actor,
          { spaceId, typeId: input.typeId ?? '', customFields: {} },
          extra.customFields
        )
      : {}
    return await this._insert(gate, input, { dueDate: extra.dueDate, customFields, formId: extra.formId })
  }

  private async _insert(gate: Gate, input: CreateCard, extra: Partial<FormExtra>): Promise<CardView> {
    const spaceId = gate.space.id
    const { typeId, stateId } = await this.deps.rules.placement(spaceId, input.typeId, input.stateId)
    const [rank, backlogRank] = await Promise.all([this._bottomOf(stateId), this.deps.cards.lastBacklogRank(spaceId)])
    const now = this.deps.clock.now()
    const id = this.deps.ids.next()
    const row = {
      ..._newCard({ id, gate, input, typeId, stateId, now }),
      dueDate: extra.dueDate ?? null,
      customFields: extra.customFields ?? {}
    }

    await this.deps.db.transaction(async (tx) => {
      const number = await this.deps.cards.nextNumber(tx, spaceId)
      await this.deps.cards.insert(tx, { ...row, number, rank, backlogRank: backlogRank + 1 })
      await this.deps.watchers.add(tx, id, _involved(gate.actor.id, input.assigneeId), now)
      await this.deps.cards.touchSpace(tx, spaceId, now)
      await this._audit(tx, gate, id, 'created', {
        ...diff(
          {},
          {
            title: input.title,
            stateId,
            typeId,
            parentId: input.parentId,
            assigneeId: input.assigneeId,
            sprintId: input.sprintId
          }
        ),
        ...(extra.formId ? { formId: { before: null, after: extra.formId } } : {})
      })
    })
    return await this._read(gate.actor, id)
  }

  async read(caller: Caller, cardId: string): Promise<CardView> {
    const { card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    return toCardView(card)
  }

  /** `REQ-12` as people type it — and still after the card moved on to be `PRD-40` (2.14). */
  async readByKey(caller: Caller, key: string): Promise<CardView> {
    const actor = await this.deps.gate.actorOf(caller)
    const found = await this.deps.cards.findByKey(actor.organizationId, key)
    if (!found) {
      throw new NotFoundException('Card', key)
    }
    return await this.read(caller, found.id)
  }

  /** A field at a time or many at once; each changed field is one line of the card's history. */
  async update(caller: Caller, cardId: string, input: UpdateCard): Promise<CardView> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const fields = await this._fieldsToWrite(gate, card, input)
    const movesState = fields.stateId !== undefined && fields.stateId !== card.stateId
    const rank = movesState ? await this._bottomOf(fields.stateId as string, card.id) : undefined
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      await this.deps.cards.update(tx, card.id, { ...fields, ...(rank === undefined ? {} : { rank }) }, now)
      await this.deps.watchers.add(tx, card.id, input.assigneeId ? [input.assigneeId] : [], now)
      await this.deps.cards.touchSpace(tx, card.spaceId, now)
      await this._audit(tx, gate, card.id, 'updated', _changes(card, fields))
    })
    return await this._read(gate.actor, card.id)
  }

  /** Drag and drop: a state, and a position in it. Only the moved card is written. */
  async move(caller: Caller, cardId: string, input: MoveCard): Promise<CardView> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    await this.deps.rules.placement(card.spaceId, undefined, input.stateId)
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      const column = await this.deps.cards.column(input.stateId, card.id)
      const rank = await this._rankAt(column, input.index, (ids) => this.deps.cards.renumber(tx, ids))
      await this.deps.cards.update(tx, card.id, { stateId: input.stateId, rank }, now)
      await this.deps.cards.touchSpace(tx, card.spaceId, now)
      if (input.stateId !== card.stateId) {
        await this._audit(tx, gate, card.id, 'moved', { stateId: { before: card.stateId, after: input.stateId } })
      }
    })
    return await this._read(gate.actor, card.id)
  }

  /**
   * A position in the backlog (3.3): the space's cards not done nor cancelled, in one manual order.
   * Ordering is not a change to the card, so it leaves no line in its history — as on the board.
   */
  async rankInBacklog(caller: Caller, cardId: string, index: number): Promise<CardView> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const open = (await this.deps.workflows.states(card.spaceId))
      .filter((state) => state.group === 'not_started' || state.group === 'in_progress')
      .map((state) => state.id)
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      const backlog = await this.deps.cards.backlog(card.spaceId, open, card.id)
      const backlogRank = await this._rankAt(backlog, index, (ids) => this.deps.cards.renumberBacklog(tx, ids))
      await this.deps.cards.update(tx, card.id, { backlogRank }, now)
    })
    return await this._read(gate.actor, card.id)
  }

  /**
   * To another space (2.14). The card takes the next number there and keeps its comments, links,
   * attachments, followers and history; its old key keeps opening it. Custom fields are the old
   * space's, so their values stay only in the history. A card with subtasks moves after them.
   */
  async transfer(caller: Caller, cardId: string, input: TransferCard): Promise<CardView> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const target = await this._transferTarget(caller, card, input)
    const { typeId, stateId } = await this.deps.rules.placement(target.space.id, input.typeId, input.stateId)
    const [rank, backlogRank] = await Promise.all([
      this._bottomOf(stateId),
      this.deps.cards.lastBacklogRank(target.space.id)
    ])
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      const number = await this.deps.cards.nextNumber(tx, target.space.id)
      const moved = {
        spaceId: target.space.id,
        number,
        typeId,
        stateId,
        parentId: null,
        sprintId: null,
        customFields: {},
        rank
      }
      await this.deps.cards.insertAlias(tx, _alias(card, now))
      await this.deps.cards.update(tx, card.id, { ...moved, backlogRank: backlogRank + 1 }, now)
      await this.deps.cards.touchSpace(tx, target.space.id, now)
      await this._audit(tx, target, card.id, 'transferred', {
        ..._changes(card, { spaceId: target.space.id, typeId, stateId, parentId: null, sprintId: null }),
        key: { before: `${card.spaceKey}-${card.number}`, after: `${target.space.key}-${number}` },
        ...fieldChanges(card.customFields as Record<string, unknown>, {})
      })
    })
    return await this._read(gate.actor, card.id)
  }

  async history(caller: Caller, cardId: string): Promise<{ items: AuditEventView[] }> {
    const { card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    return { items: await this.deps.audit.listForEntity('card', card.id) }
  }

  private async _read(actor: MemberRow, cardId: string): Promise<CardView> {
    const card = await this.deps.cards.find(actor.organizationId, cardId)
    if (!card) {
      throw new NotFoundException('Card', cardId)
    }
    return toCardView(card)
  }

  private async _assertPeopleAndParent(gate: Gate, input: CreateCard): Promise<void> {
    if (input.assigneeId) {
      await this.deps.rules.activeMember(gate.actor, input.assigneeId)
    }
    if (input.parentId) {
      await this.deps.rules.assertParent(gate.actor, gate.space.id, input.parentId)
    }
  }

  /** What an update writes, each value checked against the card's space first. */
  private async _fieldsToWrite(gate: Gate, card: CardRow, input: UpdateCard): Promise<CardFields> {
    const { customFields, ...standard } = input
    if (input.stateId || input.typeId) {
      await this.deps.rules.placement(card.spaceId, input.typeId, input.stateId)
    }
    if (input.assigneeId) {
      await this.deps.rules.activeMember(gate.actor, input.assigneeId)
    }
    if (input.groupId) {
      await this.deps.rules.activeGroup(gate.actor, input.groupId)
    }
    if (input.parentId) {
      await this.deps.rules.assertParent(gate.actor, card.spaceId, input.parentId, card.id)
    }
    if (input.sprintId) {
      await this.deps.rules.assertSprint(gate.actor, card.spaceId, input.sprintId)
    }
    const fields = Object.fromEntries(Object.entries(standard).filter(([, value]) => value !== undefined)) as CardFields
    if (customFields) {
      const typeId = input.typeId ?? card.typeId
      fields.customFields = await this.deps.rules.customFields(gate.actor, { ...card, typeId }, customFields)
    }
    return fields
  }

  private async _transferTarget(caller: Caller, card: CardAccess['card'], input: TransferCard): Promise<Gate> {
    if (input.spaceId === card.spaceId) {
      throw new ValidationException(`Card "${card.spaceKey}-${card.number}" is already in this space`, input)
    }
    const target = await this.deps.gate.checkWritable(caller, input.spaceId, 'space:write')
    const children = await this.deps.cards.childIds(card.id)
    if (children.length > 0) {
      throw new ConflictException(
        `Card "${card.spaceKey}-${card.number}" has ${children.length} subtasks; move or detach them first`,
        { cardId: card.id }
      )
    }
    return target
  }

  private async _bottomOf(stateId: string, except?: string): Promise<number> {
    const column = await this.deps.cards.column(stateId, except)
    return rankAt(
      column.map((each) => each.rank),
      column.length
    ) as number
  }

  /** The midpoint at `index`; when the neighbours are too close, the list is renumbered 1, 2, 3… first. */
  private async _rankAt(
    list: readonly { id: string; rank: number }[],
    index: number,
    renumber: (ids: string[]) => Promise<void>
  ): Promise<number> {
    const rank = rankAt(
      list.map((each) => each.rank),
      index
    )
    if (rank !== undefined) {
      return rank
    }
    await renumber(list.map((each) => each.id))
    return rankAt(
      list.map((_, position) => position + 1),
      index
    ) as number
  }

  private async _audit(tx: Database, gate: Gate, cardId: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'card',
      entityId: cardId,
      action,
      changes
    })
  }
}

/** What a form adds to a new card beyond `CreateCard`. */
export type FormExtra = { dueDate: string | null; customFields: Record<string, unknown>; formId: string }

type NewCard = { id: string; gate: Gate; input: CreateCard; typeId: string; stateId: string; now: Date }

const _newCard = ({
  id,
  gate,
  input,
  typeId,
  stateId,
  now
}: NewCard): Omit<CardRow, 'number' | 'rank' | 'backlogRank'> => ({
  id,
  organizationId: gate.actor.organizationId,
  spaceId: gate.space.id,
  typeId,
  stateId,
  title: input.title,
  description: input.description,
  assigneeId: input.assigneeId ?? null,
  groupId: null,
  reporterId: gate.actor.id,
  priority: input.priority,
  labels: input.labels,
  dueDate: null,
  estimate: null,
  points: null,
  sprintId: input.sprintId ?? null,
  parentId: input.parentId ?? null,
  customFields: {},
  createdAt: now,
  updatedAt: now
})

/** The reporter and the assignee follow a card from the start (2.11). */
const _involved = (reporterId: string, assigneeId?: string | null): string[] =>
  assigneeId ? [reporterId, assigneeId] : [reporterId]

const _alias = (card: CardAccess['card'], at: Date) => ({
  organizationId: card.organizationId,
  spaceKey: card.spaceKey,
  number: card.number,
  cardId: card.id,
  createdAt: at
})

/** Field-by-field changes; labels compare by content, custom values field by field. */
const _changes = (card: CardRow, fields: CardFields): Changes => {
  const { customFields, ...standard } = fields
  const changes = diff(card as unknown as Record<string, unknown>, standard as Record<string, unknown>)
  if (standard.labels && JSON.stringify(standard.labels) === JSON.stringify(card.labels)) {
    delete changes.labels
  }
  return customFields
    ? {
        ...changes,
        ...fieldChanges(card.customFields as Record<string, unknown>, customFields as Record<string, unknown>)
      }
    : changes
}
