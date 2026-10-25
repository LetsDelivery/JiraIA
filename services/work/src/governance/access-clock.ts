import { type Clock, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { SystemActors } from '../members/system-actor.js'
import { earliestOf } from '../wake/times.js'
import type { CatalogRepository } from './catalog.repository.js'
import type { SystemRow } from './catalog.schemas.js'
import type { SlaClock } from './holidays.js'
import type { Removals } from './removals.js'
import type { EntitlementRequestRepository } from './request.repository.js'
import type { EntitlementRequestRow, EntitlementRow } from './request.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  catalog: CatalogRepository
  requests: EntitlementRequestRepository
  sla: SlaClock
  system: SystemActors
  removals: Removals
}

/**
 * What access governance does without anyone asking (ADR-0024). A departure opens, in the same
 * transaction, a removal of everything the person holds, on the 24-hour clock. On a schedule, an
 * expired privileged grant opens its removal, and a request past its deadline is marked overdue —
 * once, so its owners and operators hear about it once. Removals are opened by "Automação", so no
 * operator is ever blocked from carrying one out for having asked for it.
 */
export class AccessClock {
  constructor(private readonly deps: Deps) {}

  /** Called by the deactivation, inside its transaction. */
  async depart(tx: Database, input: { organizationId: string; actorId: string; memberId: string; at: Date }) {
    for (const grant of await this.deps.requests.openGrantsOf(input.memberId)) {
      await this.deps.requests.update(tx, grant.id, { status: 'cancelled' })
      await this.deps.removals.audit(tx, input, grant.id, 'cancelled', {
        status: { before: grant.status, after: 'cancelled' }
      })
    }
    const held = await this.deps.requests.heldBy(input.memberId)
    if (held.length === 0) {
      return
    }
    const automation = await this.deps.system.automation(input.organizationId)
    const cause = { ...input, requesterId: automation.member.id, origin: 'departure' as const }
    for (const entitlement of held) {
      const system = await this._system(input.organizationId, entitlement.systemId)
      await this.deps.removals.open(tx, cause, entitlement, this.deps.sla.departure(system, input.at))
    }
  }

  /** When the next grant expires or the next approved request falls due, come or not (ADR-0035). */
  async nextDue(): Promise<Date | null> {
    return earliestOf(await this.deps.requests.nextExpiry(), await this.deps.requests.nextOverdue())
  }

  /** One pass of the schedule; returns what it opened and what it found late. */
  async sweep(): Promise<{ expired: number; overdue: number }> {
    const now = this.deps.clock.now()
    const expired = await this.deps.requests.expired(now)
    for (const entitlement of expired) {
      await this._expire(entitlement, now)
    }
    const overdue = await this.deps.requests.overdue(now)
    for (const request of overdue) {
      await this._overdue(request, now)
    }
    return { expired: expired.length, overdue: overdue.length }
  }

  private async _expire(entitlement: EntitlementRow, now: Date): Promise<void> {
    const automation = await this.deps.system.automation(entitlement.organizationId)
    const id = automation.member.id
    const cause = {
      organizationId: entitlement.organizationId,
      actorId: id,
      requesterId: id,
      origin: 'expiry' as const,
      at: now
    }
    const system = await this._system(entitlement.organizationId, entitlement.systemId)
    const dueAt = await this.deps.sla.removal(system, now)
    await this.deps.db.transaction((tx) => this.deps.removals.open(tx, cause, entitlement, dueAt))
  }

  private async _overdue(request: EntitlementRequestRow, now: Date): Promise<void> {
    const automation = await this.deps.system.automation(request.organizationId)
    const cause = { organizationId: request.organizationId, actorId: automation.member.id }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.requests.update(tx, request.id, { overdueAt: now })
      await this.deps.removals.audit(tx, cause, request.id, 'overdue', {
        overdueAt: { before: null, after: now.toISOString() }
      })
    })
  }

  private async _system(organizationId: string, systemId: string): Promise<SystemRow> {
    const system = await this.deps.catalog.system(organizationId, systemId)
    if (!system) {
      throw new NotFoundException('System', systemId)
    }
    return system
  }
}
