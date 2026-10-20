import { type Clock, ForbiddenException, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller, TokenVerifier } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { OAuthRepository } from './oauth.repository.js'
import { type ConnectionRow, type ConnectionView, MCP_SCOPE, type TokenRow, toConnectionView } from './schemas.js'
import { ACCESS_PREFIX, digest, newAccessToken, newRefreshToken } from './secrets.js'

/** An access token lives an hour; a refresh token 30 days, and rotates on every use (ADR-0021). */
export const ACCESS_SECONDS = 3_600
const REFRESH_SECONDS = 30 * 86_400
const TOUCH_EVERY_MS = 60_000

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  oauth: OAuthRepository
}

export type IssuedTokens = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

/**
 * The tokens of OAuth connections (ADR-0021): issuing a pair, proving one on a request — as the person,
 * through the application (ADR-0022) — and the person's list of connected applications, which they may
 * end.
 */
export class OAuthTokens implements TokenVerifier {
  constructor(private readonly deps: Deps) {}

  static owns(value: string): boolean {
    return value.startsWith(ACCESS_PREFIX)
  }

  /** A fresh pair for a connection, written in the transaction that made it necessary. */
  async issue(tx: Database, connection: ConnectionRow): Promise<IssuedTokens> {
    const now = this.deps.clock.now()
    const [access, refresh] = [newAccessToken(), newRefreshToken()]
    const row = (value: string, kind: TokenRow['kind'], seconds: number): TokenRow => ({
      hash: digest(value),
      connectionId: connection.id,
      kind,
      expiresAt: new Date(now.getTime() + seconds * 1_000),
      revokedAt: null,
      createdAt: now
    })
    await this.deps.oauth.insertTokens(tx, [
      row(access, 'access', ACCESS_SECONDS),
      row(refresh, 'refresh', REFRESH_SECONDS)
    ])
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_SECONDS,
      refresh_token: refresh,
      scope: MCP_SCOPE
    }
  }

  /**
   * The person, through the application (ADR-0022) — or nothing, once the token, the connection or the
   * person has ended.
   */
  async verify(value: string): Promise<Caller | undefined> {
    const token = await this.deps.oauth.token(digest(value))
    const now = this.deps.clock.now()
    if (token?.kind !== 'access' || token.revokedAt || token.expiresAt <= now) {
      return undefined
    }
    const connection = await this.deps.oauth.connection(token.connectionId)
    const [person, client] = connection
      ? await Promise.all([
          this.deps.members.findById(connection.organizationId, connection.personId),
          this.deps.oauth.client(connection.clientId)
        ])
      : []
    if (!connection || connection.revokedAt || person?.status !== 'active' || !client) {
      return undefined
    }
    if (!connection.lastUsedAt || now.getTime() - connection.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await this.deps.oauth.touchConnection(connection.id, now)
    }
    return { subject: `oauth:${connection.id}`, emailVerified: false, memberId: person.id, via: client.name }
  }

  /** Meu perfil → Aplicativos conectados. */
  async mine(caller: Caller): Promise<{ items: ConnectionView[] }> {
    const actor = await this._person(caller)
    const rows = await this.deps.oauth.connectionsOf(actor.id)
    return { items: rows.map(({ connection, client }) => toConnectionView(connection, client)) }
  }

  /** The person ends a connection: its tokens stop at once. */
  async revoke(caller: Caller, connectionId: string): Promise<void> {
    const actor = await this._person(caller)
    const connection = await this.deps.oauth.connection(connectionId)
    if (connection?.personId !== actor.id || connection.revokedAt) {
      throw new NotFoundException('Connection', connectionId)
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.oauth.revokeConnection(tx, connection.id, this.deps.clock.now())
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: null,
        actorId: actor.id,
        entityType: 'oauth_connection',
        entityId: connection.id,
        action: 'revoked',
        changes: { revokedAt: { before: null, after: this.deps.clock.now().toISOString() } }
      })
    })
  }

  /** Connections are a person's own; an application's token does not manage them. */
  private async _person(caller: Caller) {
    const actor = await this.deps.access.actor(caller)
    if (actor.kind !== 'person' || caller.via) {
      throw new ForbiddenException('Only a person manages their connected applications', { memberId: actor.id })
    }
    return actor
  }
}
