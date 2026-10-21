import type { Database } from '@jiraia/db'
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { members } from '../schema.js'
import { accessProfiles, accessSystems, entitlementRequests, entitlements } from '../schema-governance.js'
import type {
  EntitlementFilter,
  EntitlementRead,
  EntitlementRequestRow,
  EntitlementRow,
  RequestFilter,
  RequestRead
} from './request.schemas.js'

/**
 * What a member may see of access governance (ADR-0024): everything, for an auditor or an organization
 * admin; otherwise what names them and what happens on the systems they answer for.
 */
export type Scope = { all: true } | { all: false; memberId: string; systemIds: readonly string[] }

const beneficiary = alias(members, 'beneficiary')
const requester = alias(members, 'requester')
const decider = alias(members, 'decider')
const completer = alias(members, 'completer')
const holder = alias(members, 'holder')
const grantRequest = alias(entitlementRequests, 'grant_request')

const _ids = (ids: readonly string[]) => (ids.length > 0 ? [...ids] : ['00000000-0000-0000-0000-000000000000'])

const _requestScope = (scope: Scope): SQL | undefined =>
  scope.all
    ? undefined
    : or(
        eq(entitlementRequests.requesterId, scope.memberId),
        eq(entitlementRequests.beneficiaryId, scope.memberId),
        inArray(entitlementRequests.systemId, _ids(scope.systemIds))
      )

const _entitlementScope = (scope: Scope): SQL | undefined =>
  scope.all
    ? undefined
    : or(eq(entitlements.memberId, scope.memberId), inArray(entitlements.systemId, _ids(scope.systemIds)))

export class EntitlementRequestRepository {
  constructor(private readonly db: Database) {}

  async find(organizationId: string, id: string): Promise<RequestRead | undefined> {
    const [row] = await this._requests(
      and(eq(entitlementRequests.organizationId, organizationId), eq(entitlementRequests.id, id))
    )
    return row
  }

  async list(organizationId: string, scope: Scope, filter: RequestFilter): Promise<RequestRead[]> {
    return await this._requests(
      and(
        eq(entitlementRequests.organizationId, organizationId),
        _requestScope(scope),
        filter.status ? eq(entitlementRequests.status, filter.status) : undefined,
        filter.systemId ? eq(entitlementRequests.systemId, filter.systemId) : undefined,
        filter.beneficiaryId ? eq(entitlementRequests.beneficiaryId, filter.beneficiaryId) : undefined
      )
    )
  }

  /** A request still waiting for the same thing: same profile, same person, same kind. */
  async openFor(profileId: string, beneficiaryId: string, kind: string): Promise<EntitlementRequestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(entitlementRequests)
      .where(
        and(
          eq(entitlementRequests.profileId, profileId),
          eq(entitlementRequests.beneficiaryId, beneficiaryId),
          eq(entitlementRequests.kind, kind),
          inArray(entitlementRequests.status, ['requested', 'approved'])
        )
      )
    return row
  }

  async insert(tx: Database, row: EntitlementRequestRow): Promise<void> {
    await tx.insert(entitlementRequests).values(row)
  }

  async update(tx: Database, id: string, fields: Partial<EntitlementRequestRow>): Promise<void> {
    await tx.update(entitlementRequests).set(fields).where(eq(entitlementRequests.id, id))
  }

  async entitlement(organizationId: string, id: string): Promise<EntitlementRead | undefined> {
    const [row] = await this._entitlements(
      and(eq(entitlements.organizationId, organizationId), eq(entitlements.id, id))
    )
    return row
  }

  async held(profileId: string, memberId: string): Promise<EntitlementRow | undefined> {
    const [row] = await this.db
      .select()
      .from(entitlements)
      .where(
        and(eq(entitlements.profileId, profileId), eq(entitlements.memberId, memberId), isNull(entitlements.removedAt))
      )
    return row
  }

  async entitlements(organizationId: string, scope: Scope, filter: EntitlementFilter): Promise<EntitlementRead[]> {
    return await this._entitlements(
      and(
        eq(entitlements.organizationId, organizationId),
        _entitlementScope(scope),
        filter.memberId ? eq(entitlements.memberId, filter.memberId) : undefined,
        filter.systemId ? eq(entitlements.systemId, filter.systemId) : undefined,
        filter.held ? isNull(entitlements.removedAt) : undefined
      )
    )
  }

  async insertEntitlement(tx: Database, row: EntitlementRow): Promise<void> {
    await tx.insert(entitlements).values(row)
  }

  async endEntitlement(tx: Database, id: string, removalRequestId: string, at: Date): Promise<void> {
    await tx.update(entitlements).set({ removalRequestId, removedAt: at }).where(eq(entitlements.id, id))
  }

  /** Requests with the names they point at; newest first. */
  private async _requests(where: SQL | undefined): Promise<RequestRead[]> {
    const rows = await this.db
      .select({
        request: entitlementRequests,
        systemName: accessSystems.name,
        profileName: accessProfiles.name,
        privilege: accessProfiles.privilege,
        beneficiaryName: beneficiary.name,
        beneficiaryEmail: beneficiary.email,
        requesterName: requester.name,
        deciderName: decider.name,
        completerName: completer.name
      })
      .from(entitlementRequests)
      .innerJoin(accessSystems, eq(accessSystems.id, entitlementRequests.systemId))
      .innerJoin(accessProfiles, eq(accessProfiles.id, entitlementRequests.profileId))
      .innerJoin(beneficiary, eq(beneficiary.id, entitlementRequests.beneficiaryId))
      .innerJoin(requester, eq(requester.id, entitlementRequests.requesterId))
      .leftJoin(decider, eq(decider.id, entitlementRequests.decidedBy))
      .leftJoin(completer, eq(completer.id, entitlementRequests.completedBy))
      .where(where)
      .orderBy(desc(entitlementRequests.createdAt))
      .limit(500)
    return rows.map(({ request, ...names }) => ({ ...request, ...names }))
  }

  /** Entitlements with their system, profile, holder and the reason they were granted; newest first. */
  private async _entitlements(where: SQL | undefined): Promise<EntitlementRead[]> {
    const rows = await this.db
      .select({
        entitlement: entitlements,
        systemName: accessSystems.name,
        profileName: accessProfiles.name,
        privilege: accessProfiles.privilege,
        memberName: holder.name,
        memberEmail: holder.email,
        grantReason: grantRequest.reason
      })
      .from(entitlements)
      .innerJoin(accessSystems, eq(accessSystems.id, entitlements.systemId))
      .innerJoin(accessProfiles, eq(accessProfiles.id, entitlements.profileId))
      .innerJoin(holder, eq(holder.id, entitlements.memberId))
      .innerJoin(grantRequest, eq(grantRequest.id, entitlements.grantRequestId))
      .where(where)
      .orderBy(desc(entitlements.grantedAt))
      .limit(1000)
    return rows.map(({ entitlement, ...names }) => ({ ...entitlement, ...names }))
  }
}
