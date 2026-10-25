import { assertCan, can, type Role } from '@jiraia/authorization'
import { type Clock, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver, Product } from '../access.js'
import type { AuditTrail, Changes } from '../audit/audit.js'
import type { GroupRepository } from '../groups/group.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { GrantedSpace, GrantRepository } from './grant.repository.js'
import type { AccessView, GrantsView } from './grant.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  access: AccessResolver
  grants: GrantRepository
  groups: GroupRepository
  members: MemberRepository
}

/** The space being changed, and who is changing it. */
export type Managed = { actor: MemberRow; space: GrantedSpace }

/**
 * The roles given on a space of either product, to people and to groups, and why someone holds the
 * access they do (ADR-0012). Every member reads the grants; a space's admins change them.
 */
export class GrantService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, product: Product, spaceId: string): Promise<GrantsView> {
    const actor = await this.deps.access.actor(caller)
    const space = await this._space(actor, product, spaceId)
    const [groups, people, access] = await Promise.all([
      this.deps.grants.groups(product, space.id),
      this.deps.grants.people(product, space.id),
      this.deps.access.forSpace(actor, space.id, product)
    ])
    const closed = product === 'draw' ? await this.deps.access.closedAs(space.id) : undefined
    const general = closed ? null : { scope: 'organization' as const, role: 'reader' as const }
    return { general, groups, people, canManage: can(access, 'space:manage') }
  }

  async explain(caller: Caller, product: Product, spaceId: string, memberId: string): Promise<AccessView> {
    const actor = await this.deps.access.actor(caller)
    const space = await this._space(actor, product, spaceId)
    const member = memberId === 'me' ? actor : await this.deps.members.findById(actor.organizationId, memberId)
    if (!member) {
      throw new NotFoundException('Member', memberId)
    }
    const sources = await this.deps.access.sources(member, space.id, product)
    const access = await this.deps.access.forSpace(member, space.id, product)
    return {
      memberId: member.id,
      role: access.spaceRole ?? null,
      canWrite: can(access, 'space:write'),
      canManage: can(access, 'space:manage'),
      sources
    }
  }

  async putGroup(caller: Caller, product: Product, spaceId: string, groupId: string, role: Role): Promise<GrantsView> {
    const { actor, space } = await this.manage(caller, product, spaceId)
    const group = await this.deps.groups.find(actor.organizationId, groupId)
    if (!group) {
      throw new NotFoundException('Group', groupId)
    }
    const before = await this.deps.grants.groupRole(product, space.id, group.id)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.grants.putGroup(tx, product, {
        spaceId: space.id,
        groupId,
        role,
        createdAt: this.deps.clock.now()
      })
      await this._audit(tx, { actor, space }, 'space_group', groupId, before ? 'role_changed' : 'role_granted', {
        role: { before: before ?? null, after: role }
      })
    })
    return await this.list(caller, product, spaceId)
  }

  async removeGroup(caller: Caller, product: Product, spaceId: string, groupId: string): Promise<GrantsView> {
    const { actor, space } = await this.manage(caller, product, spaceId)
    const before = await this.deps.grants.groupRole(product, space.id, groupId)
    if (!before) {
      throw new NotFoundException('Group role', `${space.id}/${groupId}`)
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.grants.removeGroup(tx, product, space.id, groupId)
      await this._audit(tx, { actor, space }, 'space_group', groupId, 'role_revoked', { role: { before, after: null } })
    })
    return await this.list(caller, product, spaceId)
  }

  async putPerson(
    caller: Caller,
    product: Product,
    spaceId: string,
    memberId: string,
    role: Role
  ): Promise<GrantsView> {
    const managed = await this.manage(caller, product, spaceId)
    const target = await this.deps.members.findById(managed.actor.organizationId, memberId)
    if (target?.status !== 'active') {
      throw new NotFoundException('Active member', memberId)
    }
    await this.deps.db.transaction(async (tx) => {
      await this.grantPerson(tx, managed, product, target.id, role)
    })
    return await this.list(caller, product, spaceId)
  }

  async removePerson(caller: Caller, product: Product, spaceId: string, memberId: string): Promise<GrantsView> {
    const managed = await this.manage(caller, product, spaceId)
    const before = await this.deps.grants.personRole(product, managed.space.id, memberId)
    if (!before) {
      throw new NotFoundException('Space role', `${managed.space.id}/${memberId}`)
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.grants.removePerson(tx, product, managed.space.id, memberId)
      await this._audit(tx, managed, _personEntity(product), memberId, 'role_revoked', {
        role: { before, after: null }
      })
    })
    return await this.list(caller, product, spaceId)
  }

  /** Gives a person a role inside the caller's transaction — an approved access request goes through here. */
  async grantPerson(tx: Database, managed: Managed, product: Product, memberId: string, role: Role): Promise<void> {
    const before = await this.deps.grants.personRole(product, managed.space.id, memberId)
    const createdAt = this.deps.clock.now()
    await this.deps.grants.putPerson(tx, product, { spaceId: managed.space.id, memberId, role, createdAt })
    await this._audit(tx, managed, _personEntity(product), memberId, before ? 'role_changed' : 'role_granted', {
      role: { before: before ?? null, after: role }
    })
  }

  /** The space, and a refusal unless the caller is one of its admins (or an organization admin). */
  async manage(caller: Caller, product: Product, spaceId: string): Promise<Managed> {
    const actor = await this.deps.access.actor(caller)
    const space = await this._space(actor, product, spaceId)
    assertCan(await this.deps.access.forSpace(actor, space.id, product), 'space:manage', { spaceId })
    return { actor, space }
  }

  async space(caller: Caller, product: Product, spaceId: string): Promise<Managed> {
    const actor = await this.deps.access.actor(caller)
    return { actor, space: await this._space(actor, product, spaceId) }
  }

  private async _space(actor: MemberRow, product: Product, spaceId: string): Promise<GrantedSpace> {
    const space = await this.deps.grants.space(product, actor.organizationId, spaceId)
    // A closed wiki collection the caller cannot read does not exist for them (ADR-0034).
    if (!space || !can(await this.deps.access.forSpace(actor, space.id, product), 'space:read')) {
      throw new NotFoundException('Space', spaceId)
    }
    return space
  }

  private async _audit(
    tx: Database,
    { actor, space }: Managed,
    entityType: 'space_group' | 'space_member' | 'draw_space_member',
    entityId: string,
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: space.id,
      actorId: actor.id,
      entityType,
      entityId,
      action,
      changes
    })
  }
}

const _personEntity = (product: Product): 'space_member' | 'draw_space_member' =>
  product === 'jiraia' ? 'space_member' : 'draw_space_member'
