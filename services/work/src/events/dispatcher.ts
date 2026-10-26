import type { Clock } from '@jiraia/core'

import type { EventPublisher } from './event.js'
import type { OutboxRepository } from './outbox.js'

/** How many events one pass takes from the outbox. */
const BATCH = 100

/**
 * Moves committed events from the audit trail to the bus (ADR-0014). An event is marked only after
 * the bus took it: a failure leaves it pending for the next pass, so nothing is lost — at worst a
 * consumer sees it twice, which receipts absorb.
 */
export class Dispatcher {
  constructor(private readonly deps: { clock: Clock; outbox: OutboxRepository; publisher: EventPublisher }) {}

  /** Now, while the outbox holds anything; otherwise nothing to wake for (ADR-0035). */
  async nextDue(): Promise<Date | null> {
    return (await this.deps.outbox.hasPending()) ? this.deps.clock.now() : null
  }

  /** One pass: how many events left. */
  async dispatch(): Promise<number> {
    const events = await this.deps.outbox.pending(BATCH)
    if (events.length === 0) {
      return 0
    }
    await this.deps.publisher.publish(events)
    await this.deps.outbox.markDispatched(
      events.map((event) => event.id),
      this.deps.clock.now()
    )
    return events.length
  }
}
