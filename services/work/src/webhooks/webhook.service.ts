import { type Clock, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import { toDeliveryView, toWebhookView, type WebhookInput, type WebhookRow } from './schemas.js'
import type { WebhookSender } from './sender.js'
import { newWebhookSecret } from './signature.js'
import { assertPublicHttps } from './url-safety.js'
import type { WebhookRepository } from './webhook.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  webhooks: WebhookRepository
  sender: WebhookSender
}

/**
 * A space's outgoing webhooks (escopo-mvp 4.7), kept to its admins: the address and the deliveries
 * say where the space's data goes. The secret is shown when made or rotated, and never again.
 */
export class WebhookService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string) {
    await this.deps.gate.check(caller, spaceId, 'space:manage')
    return { items: (await this.deps.webhooks.list(spaceId)).map(toWebhookView) }
  }

  async create(caller: Caller, spaceId: string, input: WebhookInput) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    assertPublicHttps(input.url)
    const now = this.deps.clock.now()
    const row: WebhookRow = {
      id: this.deps.ids.next(),
      organizationId: gate.actor.organizationId,
      spaceId,
      ...input,
      secret: newWebhookSecret(),
      createdAt: now,
      updatedAt: now
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.webhooks.insert(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, { name: input.name, url: input.url }))
    })
    return { webhook: toWebhookView(row), secret: row.secret }
  }

  async update(caller: Caller, webhookId: string, input: WebhookInput) {
    const { gate, row } = await this._open(caller, webhookId)
    assertPublicHttps(input.url)
    const next = { ...row, ...input, updatedAt: this.deps.clock.now() }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.webhooks.update(tx, row.id, next)
      await this._audit(
        tx,
        gate,
        row.id,
        'updated',
        diff(
          { name: row.name, url: row.url, enabled: row.enabled },
          { name: next.name, url: next.url, enabled: next.enabled }
        )
      )
    })
    return toWebhookView(next)
  }

  /** A new secret; the old one stops signing at once. */
  async rotate(caller: Caller, webhookId: string) {
    const { gate, row } = await this._open(caller, webhookId)
    const next = { ...row, secret: newWebhookSecret(), updatedAt: this.deps.clock.now() }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.webhooks.update(tx, row.id, { secret: next.secret, updatedAt: next.updatedAt })
      await this._audit(tx, gate, row.id, 'secret_rotated', {})
    })
    return { webhook: toWebhookView(next), secret: next.secret }
  }

  async remove(caller: Caller, webhookId: string) {
    const { gate, row } = await this._open(caller, webhookId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.webhooks.delete(tx, row.id)
      await this._audit(tx, gate, row.id, 'deleted', { name: { before: row.name, after: null } })
    })
    return await this.list(caller, row.spaceId)
  }

  async deliveries(caller: Caller, webhookId: string) {
    const { row } = await this._open(caller, webhookId)
    return { items: (await this.deps.webhooks.deliveries(row.id, 30)).map(toDeliveryView) }
  }

  /** Sends one delivery again now, whatever happened to it before. */
  async redeliver(caller: Caller, webhookId: string, deliveryId: string) {
    const { row } = await this._open(caller, webhookId)
    const delivery = await this.deps.webhooks.delivery(row.id, deliveryId)
    if (!delivery) {
      throw new NotFoundException('Webhook delivery', deliveryId)
    }
    return toDeliveryView(await this.deps.sender.attempt({ ...delivery, status: 'pending' }, row))
  }

  private async _open(caller: Caller, webhookId: string): Promise<{ gate: Gate; row: WebhookRow }> {
    const actor = await this.deps.gate.actorOf(caller)
    const row = await this.deps.webhooks.find(actor.organizationId, webhookId)
    if (!row) {
      throw new NotFoundException('Webhook', webhookId)
    }
    return { gate: await this.deps.gate.check(caller, row.spaceId, 'space:manage'), row }
  }

  private async _audit(tx: Database, gate: Gate, id: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'webhook',
      entityId: id,
      action,
      changes
    })
  }
}
