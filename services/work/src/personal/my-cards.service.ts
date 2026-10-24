import { type Clock, toIso } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { CardGate } from '../cards/card-gate.js'
import type { MyCardsRepository } from './my-cards.repository.js'
import type { MyCard, MyCardTab } from './my-cards.schemas.js'

type Deps = { clock: Clock; access: AccessResolver; cardGate: CardGate; myCards: MyCardsRepository }

/**
 * "Suas tarefas" on Para você: the caller's own lists of cards, and the stars behind one of them.
 * Personal, like a star on a space: nobody's data changes but theirs, so nothing is audited.
 */
export class MyCardsService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, tab: MyCardTab): Promise<{ items: MyCard[] }> {
    const actor = await this.deps.access.actor(caller)
    const rows = await this.deps.myCards.list(tab, { organizationId: actor.organizationId, meId: actor.id })
    return { items: rows.map((row) => ({ ...row, at: toIso(row.at) })) }
  }

  async starred(caller: Caller, cardId: string): Promise<{ starred: boolean }> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    return { starred: await this.deps.myCards.isStarred(gate.actor.id, card.id) }
  }

  async star(caller: Caller, cardId: string, on: boolean): Promise<{ starred: boolean }> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    if (on) {
      await this.deps.myCards.star(gate.actor.id, card.id, this.deps.clock.now())
    } else {
      await this.deps.myCards.unstar(gate.actor.id, card.id)
    }
    return { starred: on }
  }
}
