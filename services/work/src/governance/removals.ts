import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { AuditTrail, Changes } from '../audit/audit.js'
import type { EntitlementRequestRepository } from './request.repository.js'
import { BLANK_REQUEST, type EntitlementRow } from './request.schemas.js'

/** Why the platform — not a person asking — opened a removal (ADR-0024). */
export type RemovalOrigin = 'departure' | 'expiry' | 'review'

/** Who caused it (the audit's actor), who asked (the request's), and when. */
export type Cause = { organizationId: string; actorId: string; requesterId: string; origin: RemovalOrigin; at: Date }

/**
 * Opens a removal already approved — a removal narrows access, so it waits for an operator at once —
 * with its audit event, inside the caller's transaction. Shared by every path that ends an
 * entitlement without a person asking: departure, expiry and review.
 */
export class Removals {
  constructor(private readonly deps: { ids: IdGenerator; audit: AuditTrail; requests: EntitlementRequestRepository }) {}

  async open(tx: Database, cause: Cause, entitlement: EntitlementRow, dueAt: Date): Promise<string> {
    const id = this.deps.ids.next()
    await this.deps.requests.insert(tx, {
      ...BLANK_REQUEST,
      id,
      organizationId: cause.organizationId,
      systemId: entitlement.systemId,
      profileId: entitlement.profileId,
      beneficiaryId: entitlement.memberId,
      requesterId: cause.requesterId,
      kind: 'removal',
      status: 'approved',
      origin: cause.origin,
      // The platform gives no reason of its own: `origin` says why, and the panel words it.
      reason: '',
      entitlementId: entitlement.id,
      dueAt,
      createdAt: cause.at
    })
    await this.audit(tx, cause, id, 'requested', {
      kind: { before: null, after: 'removal' },
      origin: { before: null, after: cause.origin },
      entitlementId: { before: null, after: entitlement.id }
    })
    return id
  }

  async audit(
    tx: Database,
    cause: { organizationId: string; actorId: string },
    id: string,
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId: cause.organizationId,
      spaceId: null,
      actorId: cause.actorId,
      entityType: 'entitlement_request',
      entityId: id,
      action,
      changes
    })
  }
}
