import { type Clock, ForbiddenException, type IdGenerator, UnauthenticatedException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail } from '../audit/audit.js'
import { domainList, isAllowedAddress } from './domains.js'
import type { MemberRepository } from './member.repository.js'
import type { MemberRow } from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  members: MemberRepository
  /** The Google Workspace domains whose people may sign in: `uselets.com` and `lets.delivery`. */
  allowedDomains: readonly string[]
}

/**
 * Who gets in, decided from the Google ID token (ADR-0005).
 *
 * The rule is the organization's: **a verified address of our Workspace domain**. The token's `hd`
 * claim is what proves the account belongs to the Workspace — the address alone does not, because
 * anyone can create a consumer Google account for an address they do not own at a domain they do not
 * control. The `hd` hint the sign-in button sends is only a hint; this is the check.
 *
 * A person admitted for the first time is either an invited member (matched by address and bound to
 * their Google account) or a new member with no roles, who sees nothing until someone adds them.
 */
export class MemberAdmission {
  constructor(private readonly deps: Deps) {}

  /** The active member behind the caller, admitting them on their first request. */
  async admit(caller: Caller): Promise<MemberRow> {
    if (caller.memberId) {
      return await this._byToken(caller, caller.memberId)
    }
    const known = await this.deps.members.findBySubject(caller.subject)
    if (known) {
      return this._active(known, caller)
    }

    const email = this._admissibleEmail(caller)
    const organizationId = await this.deps.members.organizationId()
    if (!organizationId) {
      throw new ForbiddenException('The organization has not been bootstrapped yet', { email })
    }

    const invited = await this.deps.members.findByEmail(organizationId, email)

    try {
      return invited ? await this._link(invited, caller) : await this._join(organizationId, email, caller)
    } catch (error) {
      return await this._afterRace(caller, error)
    }
  }

  /** A caller an API token proved (ADR-0015): the member it belongs to, if still active. */
  private async _byToken(caller: Caller, memberId: string): Promise<MemberRow> {
    const organizationId = await this.deps.members.organizationId()
    const member = organizationId ? await this.deps.members.findById(organizationId, memberId) : undefined
    if (!member) {
      throw new UnauthenticatedException('The API token belongs to no member')
    }
    return this._active(member, caller)
  }

  /**
   * The panel fires several requests at once on a first sign-in, and two of them can both find
   * nobody and both try to admit. The loser's write breaks a unique index; reading again finds the
   * member the winner admitted. Anything else is rethrown.
   */
  private async _afterRace(caller: Caller, error: unknown): Promise<MemberRow> {
    const winner = await this.deps.members.findBySubject(caller.subject)
    if (!winner) {
      throw error
    }
    return this._active(winner, caller)
  }

  /**
   * The address, if the token proves it is a verified address of an allowed Workspace domain. The
   * account's `hd` must be one of them too: Google may name the organization's primary domain there for
   * an address of its other one, so either is accepted, but a consumer account (no `hd`) never is.
   */
  private _admissibleEmail(caller: Caller): string {
    const domains = this.deps.allowedDomains
    const email = caller.email
    const workspace = caller.hostedDomain !== undefined && domains.includes(caller.hostedDomain)

    if (!email || !caller.emailVerified || !workspace || !isAllowedAddress(email, domains)) {
      throw new ForbiddenException(`Only verified Google accounts of ${domainList(domains)} may sign in`, {
        email: email ?? null,
        hostedDomain: caller.hostedDomain ?? null
      })
    }

    return email
  }

  private _active(member: MemberRow, caller: Caller): MemberRow {
    if (member.status !== 'active') {
      throw new ForbiddenException('The caller is not an active member of the organization', {
        subject: caller.subject
      })
    }
    return member
  }

  /** An invited member signing in for the first time: their row gains the Google subject. */
  private async _link(invited: MemberRow, caller: Caller): Promise<MemberRow> {
    this._active(invited, caller)
    if (invited.subject && invited.subject !== caller.subject) {
      throw new ForbiddenException('This address is already bound to another Google account', {
        email: invited.email
      })
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.linkSubject(tx, invited.id, caller.subject)
      await this._audit(tx, invited, 'linked', { subject: { before: null, after: caller.subject } })
    })

    return { ...invited, subject: caller.subject }
  }

  /** Somebody of the domain nobody invited: a member with no roles, who sees nothing yet. */
  private async _join(organizationId: string, email: string, caller: Caller): Promise<MemberRow> {
    const member: MemberRow = {
      id: this.deps.ids.next(),
      organizationId,
      kind: 'person',
      subject: caller.subject,
      email,
      name: caller.name ?? email.split('@')[0] ?? email,
      jobTitle: null,
      isOrgAdmin: false,
      isSpaceManager: false,
      isAccessAuditor: false,
      status: 'active',
      createdAt: this.deps.clock.now(),
      deactivatedAt: null
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.insert(tx, member)
      await this._audit(tx, member, 'joined', { email: { before: null, after: email } })
    })

    return member
  }

  private async _audit(
    tx: Database,
    member: MemberRow,
    action: string,
    changes: Record<string, { before: unknown; after: unknown }>
  ) {
    await this.deps.audit.record(tx, {
      organizationId: member.organizationId,
      spaceId: null,
      actorId: member.id,
      entityType: 'member',
      entityId: member.id,
      action,
      changes
    })
  }
}
