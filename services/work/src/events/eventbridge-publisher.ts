import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { DependencyUnavailableException } from '@jiraia/core'

import { type DomainEvent, detailType, type EventPublisher } from './event.js'

/** `PutEvents` takes at most ten entries a call. */
const PER_CALL = 10

/** Every event of this service carries this source; the rules on the bus match on it. */
export const EVENT_SOURCE = 'jiraia.work'

/**
 * Publishes to the platform's bus `jiraia-<env>` (ADR-0014). A partly refused batch fails as a whole:
 * the dispatcher leaves it pending and the next pass sends it again — consumers absorb the repeats.
 */
export class EventBridgePublisher implements EventPublisher {
  constructor(private readonly deps: { client: EventBridgeClient; busName: string }) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (let start = 0; start < events.length; start += PER_CALL) {
      await this._send(events.slice(start, start + PER_CALL))
    }
  }

  private async _send(events: readonly DomainEvent[]): Promise<void> {
    const result = await this.deps.client.send(
      new PutEventsCommand({
        Entries: events.map((event) => ({
          EventBusName: this.deps.busName,
          Source: EVENT_SOURCE,
          DetailType: detailType(event),
          Detail: JSON.stringify(event)
        }))
      })
    )
    if ((result.FailedEntryCount ?? 0) > 0) {
      throw new DependencyUnavailableException(
        'EventBridge',
        `${result.FailedEntryCount} of ${events.length} events refused`
      )
    }
  }
}

export const eventBridgeClient = (region: string): EventBridgeClient => new EventBridgeClient({ region })
