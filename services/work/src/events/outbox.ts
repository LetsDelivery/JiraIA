import { toIso } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { asc, inArray, isNull } from 'drizzle-orm'
import type { Changes } from '../audit/audit.js'
import { auditEvents } from '../schema.js'
import type { DomainEvent } from './event.js'

/** The audit trail read as an outbox: what has committed and not yet left for the bus (ADR-0014). */
export class OutboxRepository {
  constructor(private readonly db: Database) {}

  /** Oldest first, so consumers see a card's changes in the order they happened. */
  async pending(limit: number): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(isNull(auditEvents.dispatchedAt))
      .orderBy(asc(auditEvents.occurredAt))
      .limit(limit)
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      spaceId: row.spaceId,
      actorId: row.actorId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      changes: row.changes as Changes,
      occurredAt: toIso(row.occurredAt)
    }))
  }

  async markDispatched(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length > 0) {
      await this.db
        .update(auditEvents)
        .set({ dispatchedAt: at })
        .where(inArray(auditEvents.id, [...ids]))
    }
  }
}
