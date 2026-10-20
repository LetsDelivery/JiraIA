import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AccessResolver, assertOrgAdmin } from '../access.js'
import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { GroupRepository } from './group.repository.js'
import { type CreateGroup, type GroupRow, type GroupView, toGroupView, type UpdateGroup } from './group.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  groups: GroupRepository
  members: MemberRepository
}

/**
 * Groups of members — an area or a team (ADR-0012), kept by hand. Everyone sees them, and who is in
 * them. An organization admin creates, renames and deletes a group and names its owners; an owner
 * adds and removes members.
 */
export class GroupService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller): Promise<{ items: GroupView[] }> {
    const actor = await this.deps.access.actor(caller)
    const rows = await this.deps.groups.list(actor.organizationId)
    const ids = rows.map((row) => row.id)
    const [members, grants] = await Promise.all([this.deps.groups.membersOf(ids), this.deps.groups.grantsOf(ids)])
    return { items: rows.map((row) => toGroupView(row, members, actor, grants)) }
  }

  async read(caller: Caller, groupId: string): Promise<GroupView> {
    const actor = await this.deps.access.actor(caller)
    const group = await this._find(actor, groupId)
    const [members, grants] = await Promise.all([
      this.deps.groups.membersOf([group.id]),
      this.deps.groups.grantsOf([group.id])
    ])
    return toGroupView(group, members, actor, grants)
  }

  async create(caller: Caller, input: CreateGroup): Promise<GroupView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'create groups')
    await this._assertNameFree(actor, input.name)
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.groups.insert(tx, {
        id,
        organizationId: actor.organizationId,
        ...input,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      })
      await this._audit(tx, actor, id, 'created', diff({}, { name: input.name }))
    })
    return await this.read(caller, id)
  }

  async update(caller: Caller, groupId: string, input: UpdateGroup): Promise<GroupView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'rename groups')
    const group = await this._find(actor, groupId)
    if (input.name && input.name.toLowerCase() !== group.name.toLowerCase()) {
      await this._assertNameFree(actor, input.name)
    }
    const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    await this.deps.db.transaction(async (tx) => {
      await this.deps.groups.update(tx, group.id, fields, this.deps.clock.now())
      await this._audit(tx, actor, group.id, 'updated', diff(group as unknown as Record<string, unknown>, fields))
    })
    return await this.read(caller, groupId)
  }

  /** The group stops granting anything; its rows and history stay. */
  async remove(caller: Caller, groupId: string): Promise<{ items: GroupView[] }> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'delete groups')
    const group = await this._find(actor, groupId)
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.groups.update(tx, group.id, { deletedAt: now }, now)
      await this._audit(tx, actor, group.id, 'deleted', { name: { before: group.name, after: null } })
    })
    return await this.list(caller)
  }

  /** Adds a member, or changes whether they own the group — naming owners is an admin's. */
  async putMember(caller: Caller, groupId: string, memberId: string, isOwner: boolean): Promise<GroupView> {
    const actor = await this.deps.access.actor(caller)
    const group = await this._find(actor, groupId)
    const current = (await this.deps.groups.membersOf([group.id])).find((each) => each.memberId === memberId)
    await this._assertEdits(actor, group)
    if (isOwner !== (current?.isOwner ?? false)) {
      assertOrgAdmin(actor, 'name the owners of a group')
    }
    await this._activeMember(actor, memberId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.groups.putMember(tx, { groupId: group.id, memberId, isOwner, createdAt: this.deps.clock.now() })
      await this._audit(tx, actor, group.id, current ? 'member_changed' : 'member_added', {
        member: { before: current ? memberId : null, after: memberId },
        ...(isOwner !== (current?.isOwner ?? false)
          ? { isOwner: { before: current?.isOwner ?? false, after: isOwner } }
          : {})
      })
    })
    return await this.read(caller, groupId)
  }

  async removeMember(caller: Caller, groupId: string, memberId: string): Promise<GroupView> {
    const actor = await this.deps.access.actor(caller)
    const group = await this._find(actor, groupId)
    await this._assertEdits(actor, group)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.groups.removeMember(tx, group.id, memberId)
      await this._audit(tx, actor, group.id, 'member_removed', { member: { before: memberId, after: null } })
    })
    return await this.read(caller, groupId)
  }

  private async _find(actor: MemberRow, groupId: string): Promise<GroupRow> {
    const group = await this.deps.groups.find(actor.organizationId, groupId)
    if (!group) {
      throw new NotFoundException('Group', groupId)
    }
    return group
  }

  private async _assertNameFree(actor: MemberRow, name: string): Promise<void> {
    if (await this.deps.groups.findByName(actor.organizationId, name)) {
      throw new ConflictException(`Group "${name}" already exists`, { name })
    }
  }

  private async _assertEdits(actor: MemberRow, group: GroupRow): Promise<void> {
    const members = await this.deps.groups.membersOf([group.id])
    if (!actor.isOrgAdmin && !members.some((each) => each.memberId === actor.id && each.isOwner)) {
      throw new ForbiddenException(
        `Only an owner of group "${group.name}", or an organization admin, may change who is in it`,
        {
          groupId: group.id
        }
      )
    }
  }

  private async _activeMember(actor: MemberRow, memberId: string): Promise<void> {
    const member = await this.deps.members.findById(actor.organizationId, memberId)
    if (member?.status !== 'active') {
      throw new NotFoundException('Active member', memberId)
    }
  }

  private async _audit(tx: Database, actor: MemberRow, groupId: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'group',
      entityId: groupId,
      action,
      changes
    })
  }
}
