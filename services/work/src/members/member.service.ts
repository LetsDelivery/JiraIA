import {
  type Clock,
  ConflictException,
  ForbiddenException,
  type IdGenerator,
  NotFoundException,
  ValidationException
} from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AccessResolver, assertOrgAdmin } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from './member.repository.js'
import { type InviteMember, type MemberRow, type MemberView, toMemberView, type UpdateProfile } from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  access: AccessResolver
  audit: AuditTrail
  members: MemberRepository
  /** Only addresses of this Google Workspace domain can ever sign in (ADR-0005). */
  allowedDomain: string
}

/** The people (and, from Etapa 6, agents) of the organization (escopo-mvp 1.4, 1.5). */
export class MemberService {
  constructor(private readonly deps: Deps) {}

  async me(caller: Caller): Promise<MemberView> {
    return toMemberView(await this.deps.access.actor(caller))
  }

  /**
   * A person changes their own name and job title. Only a person: an agent's or a service account's
   * name is the admin's to give.
   */
  async updateMe(caller: Caller, input: UpdateProfile): Promise<MemberView> {
    const actor = await this.deps.access.actor(caller)
    if (actor.kind !== 'person') {
      throw new ForbiddenException(`Member "${actor.name}" is not a person and has no profile to edit`)
    }
    const after = {
      name: input.name ?? actor.name,
      jobTitle: input.jobTitle === undefined ? actor.jobTitle : input.jobTitle
    }
    const changes = this._changed(actor, after)
    if (Object.keys(changes).length > 0) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.members.updateProfile(tx, actor.id, after)
        await this._record(tx, actor, 'profile_updated', changes)
      })
    }
    return toMemberView({ ...actor, ...after })
  }

  async list(caller: Caller): Promise<{ items: MemberView[] }> {
    const actor = await this.deps.access.actor(caller)
    const rows = await this.deps.members.list(actor.organizationId)

    return { items: rows.map(toMemberView) }
  }

  /**
   * Registers a person before their first sign-in, so they arrive with their roles already given.
   * The row has no subject yet: it is bound to their Google account the first time they sign in.
   */
  async invite(caller: Caller, input: InviteMember): Promise<MemberView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'invite people')
    this._assertAllowedDomain(input.email)
    await this._assertEmailFree(actor.organizationId, input.email)

    const row = this._newPerson(actor.organizationId, input)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.insert(tx, row)
      await this._audit(tx, actor, row.id, 'invited', { email: input.email, isOrgAdmin: input.isOrgAdmin })
    })

    return toMemberView(row)
  }

  /**
   * Makes a person an organization admin, or not. Nobody removes their own admin rights, so the
   * organization can never be left without one by a single click.
   */
  async setOrgAdmin(caller: Caller, memberId: string, isOrgAdmin: boolean): Promise<MemberView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'change who is an organization admin')
    const target = await this._find(actor.organizationId, memberId)
    if (target.id === actor.id && !isOrgAdmin) {
      throw new ConflictException('An admin cannot remove their own admin rights', { memberId })
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.setOrgAdmin(tx, target.id, isOrgAdmin)
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: null,
        actorId: actor.id,
        entityType: 'member',
        entityId: target.id,
        action: isOrgAdmin ? 'made_org_admin' : 'removed_org_admin',
        changes: { isOrgAdmin: { before: target.isOrgAdmin, after: isOrgAdmin } }
      })
    })
    return toMemberView({ ...target, isOrgAdmin })
  }

  /** A space manager creates JiraIA spaces without being an organization admin (ADR-0012). */
  async setSpaceManager(caller: Caller, memberId: string, isSpaceManager: boolean): Promise<MemberView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'change who manages spaces')
    const target = await this._find(actor.organizationId, memberId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.setSpaceManager(tx, target.id, isSpaceManager)
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: null,
        actorId: actor.id,
        entityType: 'member',
        entityId: target.id,
        action: isSpaceManager ? 'made_space_manager' : 'removed_space_manager',
        changes: { isSpaceManager: { before: target.isSpaceManager, after: isSpaceManager } }
      })
    })
    return toMemberView({ ...target, isSpaceManager })
  }

  /** An access auditor reads and exports everything in access governance (ADR-0024). */
  async setAccessAuditor(caller: Caller, memberId: string, isAccessAuditor: boolean): Promise<MemberView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'change who audits access')
    const target = await this._find(actor.organizationId, memberId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.setAccessAuditor(tx, target.id, isAccessAuditor)
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: null,
        actorId: actor.id,
        entityType: 'member',
        entityId: target.id,
        action: isAccessAuditor ? 'made_access_auditor' : 'removed_access_auditor',
        changes: { isAccessAuditor: { before: target.isAccessAuditor, after: isAccessAuditor } }
      })
    })
    return toMemberView({ ...target, isAccessAuditor })
  }

  /** The row stays: every card, comment and audit event that names this member keeps its author (1.4). */
  async deactivate(caller: Caller, memberId: string): Promise<MemberView> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'deactivate people')
    const target = await this._find(actor.organizationId, memberId)
    this._assertDeactivatable(actor, target)

    const at = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.deactivate(tx, target.id, at)
      await this._audit(tx, actor, target.id, 'deactivated', { status: 'inactive' })
    })

    return toMemberView({ ...target, status: 'inactive', deactivatedAt: at })
  }

  /** An address of another domain could be invited and never sign in; refuse it at the door. */
  private _assertAllowedDomain(email: string): void {
    if (!email.endsWith(`@${this.deps.allowedDomain}`)) {
      throw new ValidationException(`Only addresses of ${this.deps.allowedDomain} can be invited`, {
        email,
        allowedDomain: this.deps.allowedDomain
      })
    }
  }

  private _newPerson(organizationId: string, input: InviteMember): MemberRow {
    return {
      id: this.deps.ids.next(),
      organizationId,
      kind: 'person',
      subject: null,
      email: input.email,
      name: input.name,
      jobTitle: input.jobTitle,
      isOrgAdmin: input.isOrgAdmin,
      isSpaceManager: false,
      isAccessAuditor: false,
      status: 'active',
      createdAt: this.deps.clock.now(),
      deactivatedAt: null
    }
  }

  private async _assertEmailFree(organizationId: string, email: string): Promise<void> {
    if (await this.deps.members.findByEmail(organizationId, email)) {
      throw new ConflictException(`A member with email "${email}" already exists`, { email })
    }
  }

  private async _find(organizationId: string, memberId: string): Promise<MemberRow> {
    const target = await this.deps.members.findById(organizationId, memberId)
    if (!target) {
      throw new NotFoundException('Member', memberId)
    }
    return target
  }

  private _assertDeactivatable(actor: MemberRow, target: MemberRow): void {
    if (target.id === actor.id) {
      throw new ConflictException('A member cannot deactivate themselves', { memberId: target.id })
    }
    if (target.status === 'inactive') {
      throw new ConflictException(`Member "${target.id}" is already inactive`, { memberId: target.id })
    }
  }

  private _changed(before: MemberRow, after: Pick<MemberRow, 'name' | 'jobTitle'>) {
    const fields = (['name', 'jobTitle'] as const).filter((field) => before[field] !== after[field])
    return Object.fromEntries(fields.map((field) => [field, { before: before[field], after: after[field] }]))
  }

  private async _record(
    tx: Database,
    actor: MemberRow,
    action: string,
    changes: Record<string, { before: unknown; after: unknown }>
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'member',
      entityId: actor.id,
      action,
      changes
    })
  }

  private async _audit(
    tx: Database,
    actor: MemberRow,
    memberId: string,
    action: string,
    after: Record<string, unknown>
  ) {
    const changes = Object.fromEntries(
      Object.entries(after).map(([field, value]) => [field, { before: null, after: value }])
    )

    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'member',
      entityId: memberId,
      action,
      changes
    })
  }
}
