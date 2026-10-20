import { can } from '@jiraia/authorization'
import { NotFoundException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { MemberRow } from '../members/schemas.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import type { CardRepository } from './card.repository.js'
import type { CardWithPeople } from './schemas.js'

export type CardAccess = { gate: Gate; card: CardWithPeople }

/**
 * "May this caller read or change this card?", asked the same way by everything that hangs off a card:
 * comments, links, attachments, watchers. Every member reads every card (ADR-0012); writing needs the
 * member or admin role on its space.
 */
export class CardGate {
  constructor(private readonly deps: { gate: SpaceGate; cards: CardRepository; access: AccessResolver }) {}

  async open(caller: Caller, cardId: string, action: 'space:read' | 'space:write'): Promise<CardAccess> {
    const actor = await this.deps.gate.actorOf(caller)
    const card = await this.deps.cards.find(actor.organizationId, cardId)
    if (!card) {
      throw new NotFoundException('Card', cardId)
    }
    const gate =
      action === 'space:write'
        ? await this.deps.gate.checkWritable(caller, card.spaceId, action)
        : await this.deps.gate.check(caller, card.spaceId, action)
    return { gate, card }
  }

  /**
   * Whether the actor could open this card, which may sit in another space — so a link to it is listed
   * only to someone who can follow it.
   */
  async sees(actor: MemberRow, card: Pick<CardWithPeople, 'spaceId'>) {
    return can(await this.deps.access.forSpace(actor, card.spaceId), 'space:read')
  }
}
