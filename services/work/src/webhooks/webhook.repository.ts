import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, lte } from 'drizzle-orm'

import { webhookDeliveries, webhooks } from '../schema-intake.js'
import type { DeliveryRow, WebhookRow } from './schemas.js'

export class WebhookRepository {
  constructor(private readonly db: Database) {}

  async list(spaceId: string, onlyEnabled = false): Promise<WebhookRow[]> {
    return await this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.spaceId, spaceId), onlyEnabled ? eq(webhooks.enabled, true) : undefined))
      .orderBy(asc(webhooks.createdAt))
  }

  async find(organizationId: string, id: string): Promise<WebhookRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.id, id)))
    return row
  }

  async findById(id: string): Promise<WebhookRow | undefined> {
    const [row] = await this.db.select().from(webhooks).where(eq(webhooks.id, id))
    return row
  }

  async insert(tx: Database, row: WebhookRow): Promise<void> {
    await tx.insert(webhooks).values(row)
  }

  async update(tx: Database, id: string, fields: Partial<WebhookRow>): Promise<void> {
    await tx.update(webhooks).set(fields).where(eq(webhooks.id, id))
  }

  /** Its deliveries go with it: they explain it and nothing else. */
  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id))
    await tx.delete(webhooks).where(eq(webhooks.id, id))
  }

  /** `false` when this webhook already has a delivery for this event — a redelivered event. */
  async addDelivery(row: DeliveryRow): Promise<boolean> {
    const inserted = await this.db
      .insert(webhookDeliveries)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id })
    return inserted.length > 0
  }

  async delivery(webhookId: string, id: string): Promise<DeliveryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.id, id)))
    return row
  }

  async updateDelivery(id: string, fields: Partial<DeliveryRow>): Promise<void> {
    await this.db.update(webhookDeliveries).set(fields).where(eq(webhookDeliveries.id, id))
  }

  async deliveries(webhookId: string, limit: number): Promise<DeliveryRow[]> {
    return await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
  }

  /** Pending deliveries whose next try is due, oldest first. */
  async due(now: Date, limit: number): Promise<DeliveryRow[]> {
    return await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now)))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit)
  }
}
