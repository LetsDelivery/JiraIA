import type { Clock, IdGenerator } from '@jiraia/core'
import type { HttpClient } from '@jiraia/http'
import type { JiraiaLogger } from '@jiraia/logger'

import type { CardRepository } from '../cards/card.repository.js'
import { toCardView } from '../cards/schemas.js'
import { type Consumer, type DomainEvent, detailType } from '../events/event.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { ProposalRepository } from '../proposals/proposal.repository.js'
import { toSprintView } from '../sprints/schemas.js'
import type { SprintRepository } from '../sprints/sprint.repository.js'
import type { DeliveryRow, WebhookRow } from './schemas.js'
import { webhookEventValues } from './schemas.js'
import { signature } from './signature.js'
import type { WebhookRepository } from './webhook.repository.js'

/** Minutes to wait before each retry: five retries after the first try, then the delivery fails. */
export const RETRY_MINUTES = [1, 5, 30, 120, 360] as const

const MINUTE_MS = 60_000
const EVENTS = new Set<string>(webhookEventValues)

type Deps = {
  clock: Clock
  ids: IdGenerator
  logger: JiraiaLogger
  http: HttpClient
  webhooks: WebhookRepository
  cards: CardRepository
  members: MemberRepository
  proposals: ProposalRepository
  sprints: SprintRepository
}

/**
 * Outgoing webhooks (escopo-mvp 4.7): for each card event a space's webhooks asked for, one delivery
 * — a signed JSON POST — tried at once, then again on a schedule until the receiver answers 2xx or
 * the retries run out. One delivery per webhook and event, however often the bus repeats it.
 */
export class WebhookSender implements Consumer {
  readonly name = 'webhooks'

  constructor(private readonly deps: Deps) {}

  accepts(event: DomainEvent): boolean {
    return event.spaceId !== null && EVENTS.has(detailType(event))
  }

  async handle(event: DomainEvent): Promise<void> {
    const type = detailType(event)
    const hooks = (await this.deps.webhooks.list(event.spaceId as string, true)).filter((hook) =>
      (hook.events as string[]).includes(type)
    )
    if (hooks.length === 0) {
      return
    }
    const payload = await this._payload(event)
    for (const hook of hooks) {
      const delivery = this._delivery(hook, event, payload)
      if (await this.deps.webhooks.addDelivery(delivery)) {
        await this.attempt(delivery, hook)
      }
    }
  }

  /** When the retry sweep has something to try (ADR-0035). */
  async nextDue(): Promise<Date | null> {
    return await this.deps.webhooks.nextAttempt()
  }

  /** The retry sweep: every pending delivery whose time has come. */
  async retryDue(limit = 100): Promise<number> {
    const due = await this.deps.webhooks.due(this.deps.clock.now(), limit)
    for (const delivery of due) {
      const hook = await this.deps.webhooks.findById(delivery.webhookId)
      if (hook?.enabled) {
        await this.attempt(delivery, hook)
      } else {
        await this.deps.webhooks.updateDelivery(delivery.id, {
          status: 'failed',
          nextAttemptAt: null,
          lastError: 'The webhook is off'
        })
      }
    }
    return due.length
  }

  /** One try: signed now, so the timestamp the receiver checks is the moment it was sent. */
  async attempt(delivery: DeliveryRow, hook: WebhookRow): Promise<DeliveryRow> {
    const body = JSON.stringify(delivery.payload)
    const now = this.deps.clock.now()
    const outcome = await this._send(hook, delivery, body, now)
    const attempts = delivery.attempts + 1
    const next: Partial<DeliveryRow> = outcome.ok
      ? {
          status: 'delivered',
          attempts,
          lastStatus: outcome.status,
          lastError: null,
          nextAttemptAt: null,
          deliveredAt: now
        }
      : { attempts, lastStatus: outcome.status, lastError: outcome.error, ..._afterFailure(attempts, now) }
    await this.deps.webhooks.updateDelivery(delivery.id, next)
    return { ...delivery, ...next }
  }

  private async _send(hook: WebhookRow, delivery: DeliveryRow, body: string, now: Date) {
    try {
      const response = await this.deps.http.send({
        method: 'POST',
        url: hook.url,
        timeoutMs: 10_000,
        body,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'JiraIA-Webhooks/1',
          'x-jiraia-event': delivery.eventType,
          'x-jiraia-delivery': delivery.id,
          'x-jiraia-signature': signature(hook.secret, Math.floor(now.getTime() / 1000), body)
        }
      })
      const ok = response.status >= 200 && response.status < 300
      return {
        ok,
        status: response.status,
        error: ok ? null : `HTTP ${response.status}: ${response.body.slice(0, 200)}`
      }
    } catch (error) {
      return { ok: false, status: null, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** What the receiver gets: the event, the card or the proposal as it is now, and who did it. */
  private async _payload(event: DomainEvent) {
    const [subject, actor] = await Promise.all([
      this._subject(event),
      this.deps.members.findById(event.organizationId, event.actorId)
    ])
    return {
      id: event.id,
      type: detailType(event),
      occurredAt: event.occurredAt,
      actor: { id: event.actorId, name: actor?.name ?? '' },
      changes: event.changes,
      ...subject
    }
  }

  private async _subject(event: DomainEvent): Promise<object> {
    if (event.entityType === 'sprint') {
      return await this._sprint(event)
    }
    return event.entityType === 'proposal' ? await this._proposal(event) : await this._card(event)
  }

  /** A sprint as the API shows it: its dates, and what it committed, completed and carried. */
  private async _sprint(event: DomainEvent) {
    const sprint = await this.deps.sprints.find(event.organizationId, event.entityId)
    return { sprint: sprint ? toSprintView(sprint) : { id: event.entityId } }
  }

  private async _card(event: DomainEvent) {
    const card = await this.deps.cards.find(event.organizationId, event.entityId)
    return { card: card ? toCardView(card) : { id: event.entityId } }
  }

  /** A proposal's summary: what it asked, where it stands, and each item's fate and card. */
  private async _proposal(event: DomainEvent) {
    const proposal = await this.deps.proposals.find(event.organizationId, event.entityId)
    if (!proposal) {
      return { proposal: { id: event.entityId } }
    }
    const { id, authorId, reason, status, autoApplied, note, items } = proposal
    return {
      proposal: {
        id,
        authorId,
        reason,
        status,
        autoApplied,
        note,
        items: items.map((item) => ({
          kind: item.kind,
          status: item.status,
          cardId: (item.result as { cardId?: string } | null)?.cardId ?? item.cardId
        }))
      }
    }
  }

  private _delivery(hook: WebhookRow, event: DomainEvent, payload: unknown): DeliveryRow {
    const now = this.deps.clock.now()
    return {
      id: this.deps.ids.next(),
      webhookId: hook.id,
      eventId: event.id,
      eventType: detailType(event),
      payload,
      status: 'pending',
      attempts: 0,
      lastStatus: null,
      lastError: null,
      nextAttemptAt: now,
      deliveredAt: null,
      createdAt: now
    }
  }
}

/** After a failed try: wait the next interval, or give up once the retries are spent. */
const _afterFailure = (attempts: number, now: Date): Partial<DeliveryRow> => {
  const wait = RETRY_MINUTES[attempts - 1]
  return wait === undefined
    ? { status: 'failed', nextAttemptAt: null }
    : { status: 'pending', nextAttemptAt: new Date(now.getTime() + wait * MINUTE_MS) }
}
