import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AccessResolver, assertOrgAdmin } from '../access.js'
import { type AuditEntityType, type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CatalogRepository } from './catalog.repository.js'
import {
  type CreateProfile,
  type CreateSystem,
  type Duty,
  type ProfileRow,
  type SystemRow,
  type SystemView,
  toSystemView,
  type UpdateProfile,
  type UpdateSystem
} from './catalog.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  catalog: CatalogRepository
  members: MemberRepository
}

/** Changes to apply, with `archived` turned into the timestamp it stands for. */
const _fields = <T extends { archived?: boolean | undefined }>(input: T, at: Date) => {
  const { archived, ...rest } = input
  const fields = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined))
  return archived === undefined ? fields : { ...fields, archivedAt: archived ? at : null }
}

/**
 * The catalog of access governance (ADR-0024): the systems LET’S grants access to, who answers for
 * each, and the profiles each grants. Every member sees it — it is what they ask from. An
 * organization admin creates systems and names their staff; an owner keeps the profiles.
 */
export class CatalogService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller): Promise<{ items: SystemView[] }> {
    const actor = await this.deps.access.actor(caller)
    const rows = await this.deps.catalog.systems(actor.organizationId)
    return { items: await this._views(actor, rows) }
  }

  async read(caller: Caller, systemId: string): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    const [view] = await this._views(actor, [await this._system(actor, systemId)])
    return view as SystemView
  }

  async create(caller: Caller, input: CreateSystem): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'add systems to access governance')
    await this._assertNameFree(actor, input.name)
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()
    const row = { id, organizationId: actor.organizationId, ...input, createdAt: now, updatedAt: now, archivedAt: null }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.catalog.insertSystem(tx, row)
      await this._audit(tx, actor, 'access_system', id, 'created', diff({}, input))
    })
    return await this.read(caller, id)
  }

  async update(caller: Caller, systemId: string, input: UpdateSystem): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'change systems of access governance')
    const system = await this._system(actor, systemId)
    if (input.name && input.name.toLowerCase() !== system.name.toLowerCase()) {
      await this._assertNameFree(actor, input.name)
    }
    const now = this.deps.clock.now()
    const fields = _fields(input, now)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.catalog.updateSystem(tx, system.id, { ...fields, updatedAt: now })
      await this._audit(tx, actor, 'access_system', system.id, 'updated', diff(system, fields))
    })
    return await this.read(caller, systemId)
  }

  async putStaff(caller: Caller, systemId: string, duty: Duty, memberId: string): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'name who answers for a system')
    const system = await this._system(actor, systemId)
    await this._activePerson(actor, memberId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.catalog.putStaff(tx, { systemId: system.id, memberId, duty, createdAt: this.deps.clock.now() })
      await this._audit(tx, actor, 'access_system', system.id, 'staff_added', {
        [duty]: { before: null, after: memberId }
      })
    })
    return await this.read(caller, systemId)
  }

  async removeStaff(caller: Caller, systemId: string, duty: Duty, memberId: string): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'name who answers for a system')
    const system = await this._system(actor, systemId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.catalog.removeStaff(tx, system.id, duty, memberId)
      await this._audit(tx, actor, 'access_system', system.id, 'staff_removed', {
        [duty]: { before: memberId, after: null }
      })
    })
    return await this.read(caller, systemId)
  }

  async createProfile(caller: Caller, systemId: string, input: CreateProfile): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    const system = await this._system(actor, systemId)
    await this._assertOwns(actor, system)
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.catalog.insertProfile(tx, {
        id,
        systemId,
        ...input,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      })
      await this._audit(tx, actor, 'access_profile', id, 'created', diff({}, { systemId, ...input }))
    })
    return await this.read(caller, systemId)
  }

  async updateProfile(caller: Caller, profileId: string, input: UpdateProfile): Promise<SystemView> {
    const actor = await this.deps.access.actor(caller)
    const profile = await this._profile(profileId)
    await this._assertOwns(actor, await this._system(actor, profile.systemId))
    const now = this.deps.clock.now()
    const fields = _fields(input, now)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.catalog.updateProfile(tx, profile.id, { ...fields, updatedAt: now })
      await this._audit(tx, actor, 'access_profile', profile.id, 'updated', diff(profile, fields))
    })
    return await this.read(caller, profile.systemId)
  }

  private async _views(actor: MemberRow, rows: readonly SystemRow[]): Promise<SystemView[]> {
    const ids = rows.map((row) => row.id)
    const [profiles, staff] = await Promise.all([this.deps.catalog.profilesOf(ids), this.deps.catalog.staffOf(ids)])
    return rows.map((row) => toSystemView(row, profiles, staff, actor))
  }

  private async _system(actor: MemberRow, systemId: string): Promise<SystemRow> {
    const system = await this.deps.catalog.system(actor.organizationId, systemId)
    if (!system) {
      throw new NotFoundException('System', systemId)
    }
    return system
  }

  private async _profile(profileId: string): Promise<ProfileRow> {
    const profile = await this.deps.catalog.profile(profileId)
    if (!profile) {
      throw new NotFoundException('Profile', profileId)
    }
    return profile
  }

  private async _assertNameFree(actor: MemberRow, name: string): Promise<void> {
    const rows = await this.deps.catalog.systems(actor.organizationId)
    if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`System "${name}" already exists`, { systemName: name })
    }
  }

  private async _assertOwns(actor: MemberRow, system: SystemRow): Promise<void> {
    const duties = await this.deps.catalog.dutiesOf(actor.id)
    if (!actor.isOrgAdmin && !duties.some((each) => each.systemId === system.id && each.duty === 'owner')) {
      throw new ForbiddenException(`Only an owner of system "${system.name}" may change its profiles`, {
        systemId: system.id
      })
    }
  }

  /** Staff are people: an agent neither approves nor carries out. */
  private async _activePerson(actor: MemberRow, memberId: string): Promise<void> {
    const member = await this.deps.members.findById(actor.organizationId, memberId)
    if (member?.status !== 'active' || member.kind !== 'person') {
      throw new NotFoundException('Active person', memberId)
    }
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
