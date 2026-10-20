import type { Clock } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { CardGate } from './card-gate.js'
import type { WatcherRepository } from './watcher.repository.js'

/**
 * Following a card (escopo-mvp 2.11): a member follows or stops following it for themselves.
 *
 * Personal, like a star: it changes nobody's data but the follower's, so it is not audited. The
 * reporter, the assignee, commenters and those mentioned follow a card without asking; the
 * notifications of Etapa 5 are sent to whoever follows it.
 */
export class WatcherService {
  constructor(private readonly deps: { db: Database; clock: Clock; cardGate: CardGate; watchers: WatcherRepository }) {}

  async list(caller: Caller, cardId: string) {
    const { card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    return { items: await this.deps.watchers.list(card.id) }
  }

  async watch(caller: Caller, cardId: string, on: boolean) {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    if (on) {
      await this.deps.watchers.add(this.deps.db, card.id, [gate.actor.id], this.deps.clock.now())
    } else {
      await this.deps.watchers.remove(card.id, gate.actor.id)
    }
    return { items: await this.deps.watchers.list(card.id) }
  }
}
