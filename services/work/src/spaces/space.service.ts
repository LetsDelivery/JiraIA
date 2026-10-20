import { assertCan, can, type Role } from '@jiraia/authorization'
import { type Clock, ConflictException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AccessResolver, assertCreatesSpaces } from '../access.js'
import { type AuditEventView, type AuditInput, type AuditTrail, diff } from '../audit/audit.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import { DEFAULT_WORKFLOWS, type WorkflowTemplate } from '../cards/workflow-defaults.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { PersonalRepository } from '../personal/personal.repository.js'
import { utcDay } from '../personal/personal.service.js'
import {
  type CreateSpace,
  type RoleHolder,
  type SpaceRow,
  type SpaceView,
  toSpaceView,
  type UpdateSpace
} from './schemas.js'
import type { SpaceRepository } from './space.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  access: AccessResolver
  audit: AuditTrail
  spaces: SpaceRepository
  members: MemberRepository
  personal: PersonalRepository
  workflows: WorkflowRepository
}

/**
 * Spaces — Jira's unit of work: a key, a type, a lead, and who holds which role (escopo-mvp 1.1, 1.3,
 * 1.7; ADR-0007).
 */
export class SpaceService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, archived: boolean): Promise<{ items: SpaceView[] }> {
    const actor = await this.deps.access.actor(caller)
    // Every space is visible to the whole organization (ADR-0012).
    const rows = await this.deps.spaces.listAll(actor.organizationId, archived)

    return { items: rows.map(toSpaceView) }
  }

  /**
   * The creator becomes the space's first admin, so the space is never born with nobody to manage it,
   * and its lead unless somebody else is named. The space starts with a working board: the default
   * workflow of its type, or `workflow` when the caller brings one (the seed, the Jira migration).
   */
  async create(caller: Caller, input: CreateSpace, workflow?: WorkflowTemplate): Promise<SpaceView> {
    const actor = await this.deps.access.actor(caller)
    assertCreatesSpaces(actor)
    await this._assertKeyFree(actor.organizationId, input.key)
    const lead = input.leadId ? await this._activeMember(actor.organizationId, input.leadId) : actor
    const now = this.deps.clock.now()
    const row: SpaceRow = {
      id: this.deps.ids.next(),
      organizationId: actor.organizationId,
      key: input.key,
      name: input.name,
      description: input.description,
      type: input.type,
      leadId: lead.id,
      nextCardNumber: 1,
      lastCardActivityAt: null,
      archivedAt: null,
      createdAt: now
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.insert(tx, row)
      await this.deps.workflows.insertTemplate(tx, {
        spaceId: row.id,
        template: workflow ?? DEFAULT_WORKFLOWS[input.type],
        ids: this.deps.ids,
        at: now
      })
      await this.deps.spaces.setRole(tx, { spaceId: row.id, memberId: actor.id, role: 'admin', at: now })
      await this._audit(tx, actor, row.id, {
        entityType: 'space',
        entityId: row.id,
        action: 'created',
        changes: diff({}, { ...input, leadId: lead.id })
      })
    })

    return toSpaceView({ ...row, leadName: lead.name })
  }

  /** Opening a space counts as a visit — what "recent" and "recommended" are made of. */
  async read(caller: Caller, spaceId: string): Promise<SpaceView> {
    const { actor, space } = await this._authorize(caller, spaceId, 'space:read')
    const at = this.deps.clock.now()
    await this.deps.personal.recordVisit({ memberId: actor.id, spaceId: space.id, day: utcDay(at), at })

    return toSpaceView(space)
  }

  async update(caller: Caller, spaceId: string, input: UpdateSpace): Promise<SpaceView> {
    const { actor, space } = await this._authorize(caller, spaceId, 'space:manage')
    this._assertActive(space)
    const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    if (input.leadId) {
      await this._activeMember(actor.organizationId, input.leadId)
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, space.id, fields)
      await this._audit(tx, actor, space.id, {
        entityType: 'space',
        entityId: space.id,
        action: 'updated',
        changes: diff(space, fields)
      })
    })

    return await this._reread(actor.organizationId, space.id)
  }

  async setArchived(caller: Caller, spaceId: string, archived: boolean): Promise<SpaceView> {
    const { actor, space } = await this._authorize(caller, spaceId, 'space:manage')
    const archivedAt = archived ? (space.archivedAt ?? this.deps.clock.now()) : null

    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, space.id, { archivedAt })
      await this._audit(tx, actor, space.id, {
        entityType: 'space',
        entityId: space.id,
        action: archived ? 'archived' : 'unarchived',
        changes: diff({ archivedAt: space.archivedAt }, { archivedAt })
      })
    })

    return toSpaceView({ ...space, archivedAt })
  }

  async listRoles(caller: Caller, spaceId: string): Promise<{ items: RoleHolder[] }> {
    await this._authorize(caller, spaceId, 'space:read')

    return { items: await this.deps.spaces.listRoles(spaceId) }
  }

  async setRole(caller: Caller, spaceId: string, memberId: string, role: Role): Promise<RoleHolder> {
    const { actor, space } = await this._authorize(caller, spaceId, 'space:manage')
    const target = await this._activeMember(actor.organizationId, memberId)
    const before = await this.deps.spaces.roleOf(space.id, target.id)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.setRole(tx, { spaceId: space.id, memberId: target.id, role, at: this.deps.clock.now() })
      await this._audit(tx, actor, space.id, {
        entityType: 'space_member',
        entityId: target.id,
        action: before ? 'role_changed' : 'role_granted',
        changes: { role: { before: before ?? null, after: role } }
      })
    })

    return {
      memberId: target.id,
      name: target.name,
      email: target.email,
      kind: target.kind as RoleHolder['kind'],
      role
    }
  }

  async removeRole(caller: Caller, spaceId: string, memberId: string): Promise<void> {
    const { actor, space } = await this._authorize(caller, spaceId, 'space:manage')
    const before = await this.deps.spaces.roleOf(space.id, memberId)
    if (!before) {
      throw new NotFoundException('Space role', `${space.id}/${memberId}`)
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.removeRole(tx, space.id, memberId)
      await this._audit(tx, actor, space.id, {
        entityType: 'space_member',
        entityId: memberId,
        action: 'role_revoked',
        changes: { role: { before, after: null } }
      })
    })
  }

  async history(caller: Caller, spaceId: string, limit: number, before?: Date): Promise<{ items: AuditEventView[] }> {
    await this._authorize(caller, spaceId, 'space:manage')

    return { items: await this.deps.audit.listForSpace(spaceId, limit, before) }
  }

  /** Reads the space and refuses — 404 before 403, so a stranger cannot probe which ids exist. */
  private async _authorize(caller: Caller, spaceId: string, action: 'space:read' | 'space:manage') {
    const actor = await this.deps.access.actor(caller)
    const space = await this.deps.spaces.find(actor.organizationId, spaceId)
    const access = space ? await this.deps.access.forSpace(actor, space.id) : undefined

    if (!space || !access || !can(access, 'space:read')) {
      throw new NotFoundException('Space', spaceId)
    }
    assertCan(access, action, { spaceId })

    return { actor, space }
  }

  private async _reread(organizationId: string, spaceId: string): Promise<SpaceView> {
    const space = await this.deps.spaces.find(organizationId, spaceId)
    if (!space) {
      throw new NotFoundException('Space', spaceId)
    }
    return toSpaceView(space)
  }

  private async _assertKeyFree(organizationId: string, key: string): Promise<void> {
    if (await this.deps.spaces.findByKey(organizationId, key)) {
      throw new ConflictException(`A space with key "${key}" already exists`, { key })
    }
  }

  private _assertActive(space: SpaceRow): void {
    if (space.archivedAt) {
      throw new ConflictException(`Space "${space.key}" is archived; unarchive it first`, { spaceId: space.id })
    }
  }

  private async _activeMember(organizationId: string, memberId: string): Promise<MemberRow> {
    const target = await this.deps.members.findById(organizationId, memberId)
    if (target?.status !== 'active') {
      throw new NotFoundException('Active member', memberId)
    }
    return target
  }

  private async _audit(
    tx: Database,
    actor: MemberRow,
    spaceId: string,
    event: Pick<AuditInput, 'entityType' | 'entityId' | 'action' | 'changes'>
  ) {
    await this.deps.audit.record(tx, { organizationId: actor.organizationId, spaceId, actorId: actor.id, ...event })
  }
}
