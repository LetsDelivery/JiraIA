import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { webhookDeliveries, webhooks } from '../schema-intake.js'
import { secretHint } from './signature.js'

export type WebhookRow = typeof webhooks.$inferSelect
export type DeliveryRow = typeof webhookDeliveries.$inferSelect

/** The card events a webhook can ask for (escopo-mvp 4.7), the proposal ones (ADR-0019) and the sprint ones (ADR-0029). */
export const webhookEventValues = [
  'card.created',
  'card.updated',
  'card.moved',
  'card.commented',
  'proposal.proposed',
  'proposal.approved',
  'proposal.rejected',
  'proposal.reverted',
  'sprint.started',
  'sprint.closed'
] as const
export const webhookEventSchema = z.enum(webhookEventValues)

export const webhookInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.url().max(1_000),
  events: z.array(webhookEventSchema).min(1),
  enabled: z.boolean().default(true)
})
export type WebhookInput = z.infer<typeof webhookInputSchema>

export const webhookViewSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  name: z.string(),
  url: z.string(),
  events: z.array(webhookEventSchema),
  enabled: z.boolean(),
  secretHint: z.string(),
  updatedAt: z.iso.datetime()
})
export type WebhookView = z.infer<typeof webhookViewSchema>
export const webhookListSchema = z.object({ items: z.array(webhookViewSchema) })

/** The only answers that carry the secret: on creation and on rotation, once. */
export const webhookWithSecretSchema = z.object({ webhook: webhookViewSchema, secret: z.string() })

export const deliveryStatusSchema = z.enum(['pending', 'delivered', 'failed'])
export const deliveryViewSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventType: z.string(),
  status: deliveryStatusSchema,
  attempts: z.number().int(),
  lastStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime()
})
export const deliveryListSchema = z.object({ items: z.array(deliveryViewSchema) })

export const webhookPathSchema = z.object({ webhookId: z.uuid() })
export const deliveryPathSchema = z.object({ webhookId: z.uuid(), deliveryId: z.uuid() })

const iso = (date: Date | null): string | null => (date ? toIso(date) : null)

export const toWebhookView = (row: WebhookRow): WebhookView => ({
  id: row.id,
  spaceId: row.spaceId,
  name: row.name,
  url: row.url,
  events: z.array(webhookEventSchema).parse(row.events),
  enabled: row.enabled,
  secretHint: secretHint(row.secret),
  updatedAt: toIso(row.updatedAt)
})

export const toDeliveryView = (row: DeliveryRow) => ({
  id: row.id,
  eventId: row.eventId,
  eventType: row.eventType,
  status: deliveryStatusSchema.parse(row.status),
  attempts: row.attempts,
  lastStatus: row.lastStatus,
  lastError: row.lastError,
  nextAttemptAt: iso(row.nextAttemptAt),
  deliveredAt: iso(row.deliveredAt),
  createdAt: toIso(row.createdAt)
})
