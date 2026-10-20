import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail } from '../audit/audit.js'
import type { MemberRow } from '../members/schemas.js'
import type { CardRepository } from './card.repository.js'
import type { CardGate } from './card-gate.js'
import type { LinkRepository, RefRow } from './link.repository.js'
import type { CardRef, CreateLink, LinkRow, LinkView, RelationsView } from './link.schemas.js'
import type { CardWithPeople } from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  cardGate: CardGate
  cards: CardRepository
  links: LinkRepository
}

/**
 * How cards tie to each other: parent and children (2.6) and typed links across spaces (2.7).
 *
 * A link is written from the card the caller can change; the other card only has to be one they can
 * read. Both cards' histories show it, each in its own space.
 */
export class LinkService {
  constructor(private readonly deps: Deps) {}

  /** Relations the caller cannot follow — a card in a space they do not read — are left out. */
  async relations(caller: Caller, cardId: string): Promise<RelationsView> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const [parent, children, links] = await Promise.all([
      card.parentId ? this.deps.links.ref(card.parentId) : undefined,
      this.deps.links.children(card.id),
      this.deps.links.linksOf(card.id)
    ])
    const views = await Promise.all(links.map((link) => this._view(gate.actor, card.id, link)))

    return {
      parent: parent && (await this.deps.cardGate.sees(gate.actor, parent)) ? _ref(parent) : null,
      children: (await this._visible(gate.actor, children)).map(_ref),
      links: views.filter((view): view is LinkView => view !== undefined)
    }
  }

  async link(caller: Caller, cardId: string, input: CreateLink): Promise<RelationsView> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const other = await this._other(gate.actor, input)
    if (other.id === card.id) {
      throw new ValidationException(`Card "${card.spaceKey}-${card.number}" cannot be linked to itself`, { cardId })
    }
    const [from, to] = input.direction === 'outward' ? [card, other] : [other, card]
    if (await this.deps.links.exists(input.type, from.id, to.id)) {
      throw new ConflictException(`${_key(from)} already ${input.type} ${_key(to)}`, { type: input.type })
    }
    const row: LinkRow = {
      id: this.deps.ids.next(),
      organizationId: gate.actor.organizationId,
      type: input.type,
      fromCardId: from.id,
      toCardId: to.id,
      createdBy: gate.actor.id,
      createdAt: this.deps.clock.now()
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.links.insert(tx, row)
      await this._recordOnBoth(tx, gate.actor, row, from, to, 'linked')
    })
    return await this.relations(caller, cardId)
  }

  async unlink(caller: Caller, cardId: string, linkId: string): Promise<RelationsView> {
    const { gate } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const link = await this.deps.links.find(cardId, linkId)
    const [from, to] = link
      ? await Promise.all([
          this.deps.cards.find(gate.actor.organizationId, link.fromCardId),
          this.deps.cards.find(gate.actor.organizationId, link.toCardId)
        ])
      : []
    if (!link || !from || !to) {
      throw new NotFoundException('Link', linkId)
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.links.delete(tx, link.id)
      await this._recordOnBoth(tx, gate.actor, link, from, to, 'unlinked')
    })
    return await this.relations(caller, cardId)
  }

  /** The card at the other end, which the caller must be able to read. */
  private async _other(actor: MemberRow, input: CreateLink): Promise<CardWithPeople> {
    const named = input.cardId ?? input.key ?? ''
    const other = input.cardId
      ? await this.deps.cards.find(actor.organizationId, input.cardId)
      : await this.deps.cards.findByKey(actor.organizationId, named)
    if (!other || !(await this.deps.cardGate.sees(actor, other))) {
      throw new NotFoundException('Card', named)
    }
    return other
  }

  private async _view(actor: MemberRow, cardId: string, link: LinkRow): Promise<LinkView | undefined> {
    const outward = link.fromCardId === cardId
    const other = await this.deps.links.ref(outward ? link.toCardId : link.fromCardId)
    if (!other || !(await this.deps.cardGate.sees(actor, other))) {
      return undefined
    }
    return {
      id: link.id,
      type: link.type as LinkView['type'],
      direction: outward ? 'outward' : 'inward',
      card: _ref(other)
    }
  }

  private async _visible(actor: MemberRow, refs: readonly RefRow[]): Promise<RefRow[]> {
    const seen = await Promise.all(refs.map((ref) => this.deps.cardGate.sees(actor, ref)))
    return refs.filter((_, index) => seen[index])
  }

  /** "PRD-12 delivers TEC-40" in both histories, each card's in its own space. */
  private async _recordOnBoth(
    tx: Database,
    actor: MemberRow,
    link: LinkRow,
    from: CardWithPeople,
    to: CardWithPeople,
    action: 'linked' | 'unlinked'
  ) {
    const value = { type: link.type, from: _key(from), to: _key(to) }
    const change = action === 'linked' ? { before: null, after: value } : { before: value, after: null }
    for (const card of [from, to]) {
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: card.spaceId,
        actorId: actor.id,
        entityType: 'card',
        entityId: card.id,
        action,
        changes: { link: change }
      })
    }
  }
}

const _key = (card: Pick<CardWithPeople, 'spaceKey' | 'number'>): string => `${card.spaceKey}-${card.number}`

const _ref = (row: RefRow): CardRef => ({
  id: row.id,
  key: row.key,
  title: row.title,
  spaceId: row.spaceId,
  state: row.state
})
