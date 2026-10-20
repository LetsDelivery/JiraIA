import { can, strongest } from '@jiraia/authorization'
import { type Clock, ConflictException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver, Product } from '../access.js'
import type { AuditTrail, Changes } from '../audit/audit.js'
import type { GrantRepository } from '../grants/grant.repository.js'
import { productSchema } from '../grants/grant.schemas.js'
import type { GrantService, Managed } from '../grants/grant.service.js'
import type { AccessRequestRepository } from './request.repository.js'
import {
  type AccessRequestRead,
  type AccessRequestView,
  type CreateAccessRequest,
  toAccessRequestView
} from './request.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  grants: GrantService
  grantRows: GrantRepository
  requests: AccessRequestRepository
}

type Decision = { approve: boolean; role: 'member' | 'admin' }

/**
 * Asking to edit a space one may only read (ADR-0012), in either product. The space's admins approve —
 * the person becomes a member of the space — or decline. Kept by hand until notifications (Etapa 5).
 */
export class AccessRequestService {
  constructor(private readonly deps: Deps) {}

  async create(caller: Caller, input: CreateAccessRequest): Promise<AccessRequestView> {
    const { actor, space } = await this.deps.grants.space(caller, input.product, input.spaceId)
    if (can(await this.deps.access.forSpace(actor, space.id, input.product), 'space:write')) {
      throw new ConflictException(`You already edit space "${space.name}"`, { spaceId: space.id })
    }
    if (await this.deps.requests.pendingOf(input.product, space.id, actor.id)) {
      throw new ConflictException(`A request to edit space "${space.name}" is already waiting`, { spaceId: space.id })
    }
    const id = this.deps.ids.next()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.requests.insert(tx, {
        id,
        organizationId: actor.organizationId,
        ...input,
        memberId: actor.id,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        createdAt: this.deps.clock.now()
      })
      await this._audit(tx, { actor, space }, id, 'requested', { message: { before: null, after: input.message } })
    })
    return toAccessRequestView(await this._find(actor.organizationId, id))
  }

  /** A space's open requests — its admins'; with no space named, the caller's own requests. */
  async list(caller: Caller, product?: Product, spaceId?: string): Promise<{ items: AccessRequestView[] }> {
    if (product && spaceId) {
      const { space } = await this.deps.grants.manage(caller, product, spaceId)
      return { items: (await this.deps.requests.pendingOn(product, space.id)).map(toAccessRequestView) }
    }
    const actor = await this.deps.access.actor(caller)
    return { items: (await this.deps.requests.mine(actor.id)).map(toAccessRequestView) }
  }

  async decide(caller: Caller, requestId: string, decision: Decision): Promise<AccessRequestView> {
    const actor = await this.deps.access.actor(caller)
    const request = await this._find(actor.organizationId, requestId)
    const product = productSchema.parse(request.product)
    const managed = await this.deps.grants.manage(caller, product, request.spaceId)
    if (request.status !== 'pending') {
      throw new ConflictException(`Request "${request.id}" was already ${request.status}`, { requestId })
    }
    const status = decision.approve ? 'approved' : 'declined'
    await this.deps.db.transaction(async (tx) => {
      await this.deps.requests.decide(tx, request.id, { status, decidedBy: actor.id, decidedAt: this.deps.clock.now() })
      await this._audit(tx, managed, request.id, status, { status: { before: 'pending', after: status } })
      if (decision.approve) {
        await this._grant(tx, managed, request, decision.role)
      }
    })
    return toAccessRequestView(await this._find(actor.organizationId, requestId))
  }

  /** Never lowers a role: approving "member" for someone who is already admin keeps them admin. */
  private async _grant(tx: Database, managed: Managed, request: AccessRequestRead, role: Decision['role']) {
    const product = productSchema.parse(request.product)
    const held = await this.deps.grantRows.personRole(product, request.spaceId, request.memberId)
    const granted = strongest([held, role]) ?? role
    await this.deps.grants.grantPerson(tx, managed, product, request.memberId, granted)
  }

  private async _find(organizationId: string, id: string): Promise<AccessRequestRead> {
    const request = await this.deps.requests.find(organizationId, id)
    if (!request) {
      throw new NotFoundException('Access request', id)
    }
    return request
  }

  private async _audit(tx: Database, { actor, space }: Managed, id: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: space.id,
      actorId: actor.id,
      entityType: 'access_request',
      entityId: id,
      action,
      changes
    })
  }
}
