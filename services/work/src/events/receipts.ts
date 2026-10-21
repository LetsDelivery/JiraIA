import type { Clock } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { and, eq } from 'drizzle-orm'

import { eventReceipts } from '../schema-intake.js'
import type { Consumer, DomainEvent } from './event.js'

/**
 * Runs a consumer on an event at most once per success: an event already handled is skipped, and the
 * receipt is written only after the handler returned — a failure leaves the event to be retried.
 */
export class Receipts {
  constructor(private readonly deps: { db: Database; clock: Clock }) {}

  async deliver(consumer: Consumer, event: DomainEvent): Promise<boolean> {
    if (!consumer.accepts(event) || (await this._seen(consumer.name, event.id))) {
      return false
    }
    await consumer.handle(event)
    await this.deps.db
      .insert(eventReceipts)
      .values({ consumer: consumer.name, eventId: event.id, handledAt: this.deps.clock.now() })
      .onConflictDoNothing()
    return true
  }

  private async _seen(consumer: string, eventId: string): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ eventId: eventReceipts.eventId })
      .from(eventReceipts)
      .where(and(eq(eventReceipts.consumer, consumer), eq(eventReceipts.eventId, eventId)))
    return Boolean(row)
  }
}

/**
 * Hands each published event to the consumers in this process — the local harness and the suites,
 * where there is no EventBridge. In AWS each consumer reads its own queue (ADR-0025).
 */
export class DirectPublisher {
  constructor(private readonly deps: { receipts: Receipts; consumers: () => readonly Consumer[] }) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const consumer of this.deps.consumers()) {
        await this.deps.receipts.deliver(consumer, event)
      }
    }
  }
}
