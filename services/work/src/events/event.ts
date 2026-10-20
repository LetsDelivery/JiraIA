import { z } from 'zod'

/**
 * A domain event: one line of the audit trail, once it has committed (ADR-0014). The trail already
 * says who did what to which entity, before and after, so the bus carries it as it is — consumers
 * read the same facts the card's history shows.
 */
export const domainEventSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  spaceId: z.uuid().nullable(),
  actorId: z.uuid(),
  entityType: z.string(),
  entityId: z.uuid(),
  action: z.string(),
  changes: z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() })),
  occurredAt: z.iso.datetime()
})
export type DomainEvent = z.infer<typeof domainEventSchema>

/**
 * The name a rule on the bus matches.
 *
 * @example detailType({ entityType: 'card', action: 'moved' })   // 'card.moved'
 */
export const detailType = (event: Pick<DomainEvent, 'entityType' | 'action'>): string =>
  `${event.entityType}.${event.action}`

/** Where events go after they commit: EventBridge in AWS, straight to the consumers locally. */
export type EventPublisher = { publish(events: readonly DomainEvent[]): Promise<void> }

/** Something that reacts to events, at least once each; it must tolerate seeing one again. */
export type Consumer = {
  readonly name: string
  accepts(event: DomainEvent): boolean
  handle(event: DomainEvent): Promise<void>
}

/** Holds what was published — the suites' publisher when no consumer should run. */
export class InMemoryPublisher implements EventPublisher {
  readonly published: DomainEvent[] = []

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events)
  }
}
