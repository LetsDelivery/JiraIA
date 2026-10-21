import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditEntityType, AuditTrail, Changes } from '../audit/audit.js'
import type { GroupRepository } from '../groups/group.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CatalogRepository } from './catalog.repository.js'
import { type Duty, dutySchema, type ProfileRow } from './catalog.schemas.js'
import { abilitiesOf, expiryOf, type Governor, hasDuty, isInvolved, scopeOf } from './policy.js'
import type { EntitlementRequestRepository } from './request.repository.js'
import {
  type CreateGrant,
  type CreateRemoval,
  type CreateRequest,
  type EntitlementFilter,
  type EntitlementView,
  type RequestFilter,
  type RequestRead,
  type RequestView,
  toEntitlementView,
  toRequestView
} from './request.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  catalog: CatalogRepository
  requests: EntitlementRequestRepository
  groups: GroupRepository
  members: MemberRepository
}

type Context = { actor: MemberRow; who: Governor }

/**
 * Entitlement requests and entitlements (ADR-0024). Access to a LET’S system changes only through a
 * request with a reason: a system owner approves a grant, an operator carries it out with evidence,
 * and only then is the profile held — or no longer held. Nobody approves nor carries out a request
 * that names them. Every step is an audit event in the same transaction.
 */
export class EntitlementRequestService {
  constructor(private readonly deps: Deps) {}

  async create(caller: Caller, input: CreateRequest): Promise<RequestView> {
    const context = await this._context(caller)
    const id = input.kind === 'grant' ? await this._grant(context, input) : await this._removal(context, input)
    return await this._view(context, id)
  }

  async list(caller: Caller, filter: RequestFilter): Promise<{ items: RequestView[] }> {
    const { actor, who } = await this._context(caller)
    const rows = await this.deps.requests.list(actor.organizationId, scopeOf(who), filter)
    return { items: rows.map((row) => toRequestView(row, abilitiesOf(who, row))) }
  }

  async read(caller: Caller, requestId: string): Promise<RequestView> {
    return await this._view(await this._context(caller), requestId)
  }

  async decide(caller: Caller, requestId: string, decision: { approve: boolean; note: string }) {
    const context = await this._context(caller)
    const request = await this._find(context, requestId)
    if (!abilitiesOf(context.who, request).canDecide) {
      this._refuse(context, request, 'approve or decline', 'owner', 'requested')
    }
    const status = decision.approve ? 'approved' : 'declined'
    const at = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      const fields = { status, decidedBy: context.actor.id, decidedAt: at, decisionNote: decision.note || null }
      await this.deps.requests.update(tx, request.id, fields)
      await this._audit(tx, context.actor, 'entitlement_request', request.id, status, {
        status: { before: request.status, after: status },
        ...(decision.note ? { note: { before: null, after: decision.note } } : {})
      })
    })
    return await this._view(context, requestId)
  }

  /** The operator did it in the system: the entitlement begins — or ends — now. */
  async complete(caller: Caller, requestId: string, evidence: string): Promise<RequestView> {
    const context = await this._context(caller)
    const request = await this._find(context, requestId)
    if (!abilitiesOf(context.who, request).canComplete) {
      this._refuse(context, request, 'carry out', 'operator', 'approved')
    }
    const at = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.requests.update(tx, request.id, {
        status: 'done',
        completedBy: context.actor.id,
        completedAt: at,
        evidence
      })
      await this._audit(tx, context.actor, 'entitlement_request', request.id, 'done', {
        status: { before: request.status, after: 'done' },
        evidence: { before: null, after: evidence }
      })
      await (request.kind === 'grant' ? this._begin(tx, context, request, at) : this._end(tx, context, request, at))
    })
    return await this._view(context, requestId)
  }

  async cancel(caller: Caller, requestId: string): Promise<RequestView> {
    const context = await this._context(caller)
    const request = await this._find(context, requestId)
    if (!abilitiesOf(context.who, request).canCancel) {
      throw new ForbiddenException(`Request "${request.id}" cannot be cancelled by you while ${request.status}`, {
        requestId: request.id
      })
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.requests.update(tx, request.id, { status: 'cancelled' })
      await this._audit(tx, context.actor, 'entitlement_request', request.id, 'cancelled', {
        status: { before: request.status, after: 'cancelled' }
      })
    })
    return await this._view(context, requestId)
  }

  async entitlements(caller: Caller, filter: EntitlementFilter): Promise<{ items: EntitlementView[] }> {
    const { actor, who } = await this._context(caller)
    const rows = await this.deps.requests.entitlements(actor.organizationId, scopeOf(who), filter)
    return { items: rows.map(toEntitlementView) }
  }

  private async _grant(context: Context, input: CreateGrant): Promise<string> {
    const { actor } = context
    const profile = await this._requestable(actor, input.profileId)
    const beneficiaryId = input.beneficiaryId ?? actor.id
    await this._assertAsksFor(context, beneficiaryId, profile.systemId)
    if (await this.deps.requests.held(profile.id, beneficiaryId)) {
      throw new ConflictException(`Profile "${profile.name}" is already held by member "${beneficiaryId}"`, {
        heldProfile: profile.name
      })
    }
    const now = this.deps.clock.now()
    const expiresAt = expiryOf(profile.privilege, input.expiresAt, now)
    return await this._insert(context, profile, beneficiaryId, {
      kind: 'grant',
      status: 'requested',
      reason: input.reason,
      expiresAt
    })
  }

  /** A removal narrows access, so it needs no approval: it waits for an operator at once. */
  private async _removal(context: Context, input: CreateRemoval): Promise<string> {
    const { actor } = context
    const entitlement = await this.deps.requests.entitlement(actor.organizationId, input.entitlementId)
    if (!entitlement || entitlement.removedAt) {
      throw new NotFoundException('Held entitlement', input.entitlementId)
    }
    await this._assertAsksFor(context, entitlement.memberId, entitlement.systemId)
    const profile = await this._profile(entitlement.profileId)
    return await this._insert(context, profile, entitlement.memberId, {
      kind: 'removal',
      status: 'approved',
      reason: input.reason,
      entitlementId: entitlement.id
    })
  }

  private async _insert(
    { actor }: Context,
    profile: ProfileRow,
    beneficiaryId: string,
    fields: { kind: string; status: string; reason: string; expiresAt?: Date | null; entitlementId?: string }
  ): Promise<string> {
    if (await this.deps.requests.openFor(profile.id, beneficiaryId, fields.kind)) {
      throw new ConflictException(`A ${fields.kind} of profile "${profile.name}" for this person is already open`, {
        openProfile: profile.name,
        beneficiaryId
      })
    }
    const id = this.deps.ids.next()
    const row = {
      ...EMPTY,
      ...fields,
      id,
      organizationId: actor.organizationId,
      systemId: profile.systemId,
      profileId: profile.id,
      beneficiaryId,
      requesterId: actor.id,
      createdAt: this.deps.clock.now()
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.requests.insert(tx, row)
      await this._audit(tx, actor, 'entitlement_request', id, 'requested', {
        kind: { before: null, after: fields.kind },
        profileId: { before: null, after: profile.id },
        beneficiaryId: { before: null, after: beneficiaryId },
        reason: { before: null, after: fields.reason }
      })
    })
    return id
  }

  private async _begin(tx: Database, { actor }: Context, request: RequestRead, at: Date): Promise<void> {
    if (await this.deps.requests.held(request.profileId, request.beneficiaryId)) {
      throw new ConflictException(`Profile "${request.profileName}" is already held by "${request.beneficiaryName}"`, {
        heldProfile: request.profileName
      })
    }
    const id = this.deps.ids.next()
    await this.deps.requests.insertEntitlement(tx, {
      id,
      organizationId: actor.organizationId,
      systemId: request.systemId,
      profileId: request.profileId,
      memberId: request.beneficiaryId,
      grantRequestId: request.id,
      grantedAt: at,
      expiresAt: request.expiresAt,
      removalRequestId: null,
      removedAt: null
    })
    await this._audit(tx, actor, 'entitlement', id, 'granted', {
      profileId: { before: null, after: request.profileId }
    })
  }

  private async _end(tx: Database, { actor }: Context, request: RequestRead, at: Date): Promise<void> {
    const entitlementId = request.entitlementId as string
    await this.deps.requests.endEntitlement(tx, entitlementId, request.id, at)
    await this._audit(tx, actor, 'entitlement', entitlementId, 'removed', {
      profileId: { before: request.profileId, after: null }
    })
  }

  /** One asks for oneself; an owner of a group, for its members; staff and admins, for anyone. */
  private async _assertAsksFor({ actor, who }: Context, beneficiaryId: string, systemId: string): Promise<void> {
    await this._activePerson(actor, beneficiaryId)
    if (beneficiaryId === actor.id || hasDuty(who, systemId, 'owner') || hasDuty(who, systemId, 'operator')) {
      return
    }
    const groupIds = await this.deps.groups.groupIdsOf(beneficiaryId)
    const owners = (await this.deps.groups.membersOf(groupIds)).filter((each) => each.isOwner)
    if (!owners.some((each) => each.memberId === actor.id)) {
      throw new ForbiddenException(`You may not ask for access for member "${beneficiaryId}"`, { beneficiaryId })
    }
  }

  private async _requestable(actor: MemberRow, profileId: string): Promise<ProfileRow> {
    const profile = await this._profile(profileId)
    const system = await this.deps.catalog.system(actor.organizationId, profile.systemId)
    if (!system || system.archivedAt || profile.archivedAt) {
      throw new ConflictException(`Profile "${profile.name}" is archived and cannot be asked for`, {
        archivedProfile: profile.name
      })
    }
    return profile
  }

  private async _profile(profileId: string): Promise<ProfileRow> {
    const profile = await this.deps.catalog.profile(profileId)
    if (!profile) {
      throw new NotFoundException('Profile', profileId)
    }
    return profile
  }

  private async _activePerson(actor: MemberRow, memberId: string): Promise<void> {
    const member = await this.deps.members.findById(actor.organizationId, memberId)
    if (member?.status !== 'active' || member.kind !== 'person') {
      throw new NotFoundException('Active person', memberId)
    }
  }

  private async _context(caller: Caller): Promise<Context> {
    const actor = await this.deps.access.actor(caller)
    const duties = new Map<string, Set<Duty>>()
    for (const { systemId, duty } of await this.deps.catalog.dutiesOf(actor.id)) {
      duties.set(systemId, new Set([...(duties.get(systemId) ?? []), dutySchema.parse(duty)]))
    }
    return {
      actor,
      who: { id: actor.id, isOrgAdmin: actor.isOrgAdmin, isAccessAuditor: actor.isAccessAuditor, duties }
    }
  }

  /** A request the caller may see; one they may not is, to them, one that does not exist. */
  private async _find({ actor, who }: Context, requestId: string): Promise<RequestRead> {
    const request = await this.deps.requests.find(actor.organizationId, requestId)
    const scope = scopeOf(who)
    const visible = scope.all || isInvolved(who, request ?? EMPTY_PARTIES) || who.duties.has(request?.systemId ?? '')
    if (!request || !visible) {
      throw new NotFoundException('Entitlement request', requestId)
    }
    return request
  }

  private async _view(context: Context, requestId: string): Promise<RequestView> {
    const request = await this._find(context, requestId)
    return toRequestView(request, abilitiesOf(context.who, request))
  }

  private _refuse({ who }: Context, request: RequestRead, action: string, duty: Duty, status: string): never {
    if (request.status !== status) {
      throw new ConflictException(`Request "${request.id}" is ${request.status}, not ${status}`, {
        requestStatus: request.status
      })
    }
    if (!hasDuty(who, request.systemId, duty)) {
      throw new ForbiddenException(`Only an ${duty} of system "${request.systemName}" may ${action} its requests`, {
        requestId: request.id
      })
    }
    throw new ForbiddenException(`You may not ${action} request "${request.id}": it names you`, {
      requestId: request.id
    })
  }

  private async _audit(
    tx: Database,
    actor: MemberRow,
    entityType: AuditEntityType,
    id: string,
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType,
      entityId: id,
      action,
      changes
    })
  }
}

const EMPTY_PARTIES = { requesterId: '', beneficiaryId: '' }

const EMPTY = {
  expiresAt: null,
  entitlementId: null,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  completedBy: null,
  completedAt: null,
  evidence: null
}
