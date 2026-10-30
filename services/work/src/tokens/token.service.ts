import { type Clock, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller, TokenVerifier } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail, Changes } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import { type ApiTokenRow, type CreateToken, toTokenView } from './schemas.js'
import type { TokenRepository } from './token.repository.js'
import { hashToken, isTokenValue, newTokenValue, tokenHint } from './token-value.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  tokens: TokenRepository
}

/** A service account's subject: no Google token carries it, and it tells it apart from "Automação". */
const SERVICE_SUBJECT = 'service:'

/** `lastUsedAt` is written at most this often, so a busy integration is not a write per request. */
const TOUCH_EVERY_MS = 60_000

const DAY_MS = 86_400_000

/**
 * API tokens (escopo-mvp 4.8, ADR-0015). A personal token acts as its person; a service account is
 * an agent member an organization admin creates, given roles on spaces like anyone, whose tokens act
 * as it. Tokens are made and revoked only from the panel — a token cannot mint another.
 */
export class TokenService implements TokenVerifier {
  constructor(private readonly deps: Deps) {}

  /** The caller a token stands for, or nothing: unknown, revoked, expired, or its member inactive. */
  async verify(value: string): Promise<Caller | undefined> {
    const row = isTokenValue(value) ? await this.deps.tokens.byHash(hashToken(value)) : undefined
    const now = this.deps.clock.now()
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) {
      return undefined
    }
    const member = await this.deps.members.findById(row.organizationId, row.memberId)
    if (member?.status !== 'active') {
      return undefined
    }
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await this.deps.tokens.touch(row.id, now)
    }
    return { subject: `token:${row.id}`, emailVerified: false, memberId: member.id }
  }

  async mine(caller: Caller) {
    const actor = await this._person(caller)
    return { items: (await this.deps.tokens.ofMembers([actor.id])).map(toTokenView) }
  }

  async createMine(caller: Caller, input: CreateToken) {
    const actor = await this._person(caller)
    return await this._issue(actor, actor, input)
  }

  /** The owner revokes their own; an organization admin revokes any. */
  async revoke(caller: Caller, tokenId: string) {
    const actor = await this._person(caller)
    const row = await this.deps.tokens.find(actor.organizationId, tokenId)
    if (!row || (row.memberId !== actor.id && !actor.isOrgAdmin)) {
      throw new NotFoundException('API token', tokenId)
    }
    if (!row.revokedAt) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.tokens.revoke(tx, row.id, this.deps.clock.now())
        await this._audit(tx, actor, row.id, 'revoked', { revokedAt: { before: null, after: true } })
      })
    }
    return toTokenView({ ...row, revokedAt: row.revokedAt ?? this.deps.clock.now() })
  }

  async serviceAccounts(caller: Caller) {
    const actor = await this._admin(caller)
    const accounts = (await this.deps.members.list(actor.organizationId)).filter((member) =>
      member.subject?.startsWith(SERVICE_SUBJECT)
    )
    const tokens = await this.deps.tokens.ofMembers(accounts.map((account) => account.id))
    return {
      items: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        status: account.status,
        tokens: tokens.filter((token) => token.memberId === account.id).map(toTokenView)
      }))
    }
  }

  /** A member that is not a person: it holds roles and shows in history under its name. */
  async createServiceAccount(caller: Caller, name: string) {
    const actor = await this._admin(caller)
    const id = this.deps.ids.next()
    const row: MemberRow = {
      id,
      organizationId: actor.organizationId,
      kind: 'agent',
      subject: `${SERVICE_SUBJECT}${id}`,
      email: null,
      name,
      jobTitle: null,
      avatarKey: null,
      isOrgAdmin: false,
      isSpaceManager: false,
      isAccessAuditor: false,
      status: 'active',
      createdAt: this.deps.clock.now(),
      deactivatedAt: null
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.insert(tx, row)
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: null,
        actorId: actor.id,
        entityType: 'member',
        entityId: id,
        action: 'created',
        changes: { kind: { before: null, after: 'agent' }, name: { before: null, after: name } }
      })
    })
    return { id, name, status: row.status, tokens: [] }
  }

  async createServiceToken(caller: Caller, memberId: string, input: CreateToken) {
    const actor = await this._admin(caller)
    const account = await this.deps.members.findById(actor.organizationId, memberId)
    if (!account?.subject?.startsWith(SERVICE_SUBJECT)) {
      throw new NotFoundException('Service account', memberId)
    }
    return await this._issue(actor, account, input)
  }

  private async _issue(actor: MemberRow, owner: MemberRow, input: CreateToken) {
    const value = newTokenValue()
    const now = this.deps.clock.now()
    const row: ApiTokenRow = {
      id: this.deps.ids.next(),
      organizationId: actor.organizationId,
      memberId: owner.id,
      createdBy: actor.id,
      name: input.name,
      hint: tokenHint(value),
      hash: hashToken(value),
      createdAt: now,
      lastUsedAt: null,
      expiresAt: input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * DAY_MS) : null,
      revokedAt: null
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.tokens.insert(tx, row)
      await this._audit(tx, actor, row.id, 'created', {
        name: { before: null, after: input.name },
        memberId: { before: null, after: owner.id }
      })
    })
    return { token: toTokenView(row), value }
  }

  /** Token management needs the person in the panel, not another token. */
  private async _person(caller: Caller): Promise<MemberRow> {
    if (caller.memberId) {
      throw new ForbiddenException('API tokens are managed from the panel, not with another token', {
        subject: caller.subject
      })
    }
    return await this.deps.access.actor(caller)
  }

  private async _admin(caller: Caller): Promise<MemberRow> {
    const actor = await this._person(caller)
    if (!actor.isOrgAdmin) {
      throw new ForbiddenException('Only organization admins manage service accounts', { memberId: actor.id })
    }
    return actor
  }

  private async _audit(tx: Database, actor: MemberRow, id: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'api_token',
      entityId: id,
      action,
      changes
    })
  }
}
