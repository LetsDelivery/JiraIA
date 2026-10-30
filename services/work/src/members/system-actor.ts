import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from './member.repository.js'
import type { MemberRow } from './schemas.js'

/**
 * Who the platform acts as when no person is acting — automations (ADR-0014) and GitHub (ADR-0038).
 *
 * One agent member per organization for each, named "Automação" and "GitHub", so every change they
 * make shows in the card's history under that name. Their subjects start with `system:`, which no
 * Google token carries, so nobody signs in as them. It may write anywhere; whether a rule may reach a space is decided by the
 * rule's owner's access before each run, never by this member.
 */
export class SystemActors {
  constructor(
    private readonly deps: {
      db: Database
      clock: Clock
      ids: IdGenerator
      audit: AuditTrail
      members: MemberRepository
    }
  ) {}

  static subject(organizationId: string): string {
    return `system:automation:${organizationId}`
  }

  /** The caller the services see; the member is created on first use. */
  async automation(organizationId: string): Promise<{ member: MemberRow; caller: Caller }> {
    return await this._actor(organizationId, SystemActors.subject(organizationId), 'Automação')
  }

  /**
   * Who acts for what GitHub tells (ADR-0038): an agent named "GitHub", so a card moved by a merge
   * says so in its history. It is not the automation actor, so the space's rules still react to it.
   */
  async github(organizationId: string): Promise<{ member: MemberRow; caller: Caller }> {
    return await this._actor(organizationId, `system:github:${organizationId}`, 'GitHub')
  }

  private async _actor(organizationId: string, subject: string, name: string) {
    const member =
      (await this.deps.members.findBySubject(subject)) ?? (await this._create(organizationId, subject, name))
    return { member, caller: { subject, emailVerified: false } satisfies Caller }
  }

  /** Whether an event was caused by an automation — such events start no other rule. */
  async isAutomation(organizationId: string, memberId: string): Promise<boolean> {
    const member = await this.deps.members.findById(organizationId, memberId)
    return member?.subject === SystemActors.subject(organizationId)
  }

  private async _create(organizationId: string, subject: string, name: string): Promise<MemberRow> {
    const row: MemberRow = {
      id: this.deps.ids.next(),
      organizationId,
      kind: 'agent',
      subject,
      email: null,
      name,
      jobTitle: null,
      avatarKey: null,
      isOrgAdmin: true,
      isSpaceManager: false,
      isAccessAuditor: false,
      status: 'active',
      createdAt: this.deps.clock.now(),
      deactivatedAt: null
    }
    // Two first runs at once both try to create it; the loser reads the winner's row.
    await this._insert(organizationId, row).catch(async (error: unknown) => {
      if (!(await this.deps.members.findBySubject(subject))) {
        throw error
      }
    })
    return (await this.deps.members.findBySubject(subject)) ?? row
  }

  private async _insert(organizationId: string, row: MemberRow): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.insert(tx, row)
      await this.deps.audit.record(tx, {
        organizationId,
        spaceId: null,
        actorId: row.id,
        entityType: 'member',
        entityId: row.id,
        action: 'created',
        changes: { kind: { before: null, after: 'agent' }, name: { before: null, after: row.name } }
      })
    })
  }
}
