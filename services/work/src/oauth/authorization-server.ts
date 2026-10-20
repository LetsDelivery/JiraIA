import { type Clock, ForbiddenException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { OAuthRepository } from './oauth.repository.js'
import type { IssuedTokens, OAuthTokens } from './oauth-tokens.js'
import {
  type Authorize,
  type ClientRow,
  type ConnectionRow,
  hostOf,
  MCP_SCOPE,
  type RegisterClient,
  type TokenRequest
} from './schemas.js'
import { digest, newCode, pkceMatches } from './secrets.js'

const CODE_MS = 10 * 60_000

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  oauth: OAuthRepository
  tokens: OAuthTokens
}

/** An answer of the token endpoint: the pair, or an OAuth error (RFC 6749 §5.2) with its status. */
export type TokenAnswer =
  | { status: 200; body: IssuedTokens }
  | { status: 400 | 401; body: { error: string; error_description: string } }

const _refuse = (error: string, description: string, status: 400 | 401 = 400): TokenAnswer => ({
  status,
  body: { error, error_description: description }
})

/**
 * JiraIA as an OAuth 2.1 authorization server for MCP clients (ADR-0021): clients register themselves,
 * a person allows one on the consent page, and the code becomes tokens that act as that person, through
 * that application (ADR-0022).
 */
export class AuthorizationServer {
  constructor(private readonly deps: Deps) {}

  async register(input: RegisterClient) {
    const organizationId = await this.deps.members.organizationId()
    if (!organizationId) {
      throw new ForbiddenException('The organization has not been bootstrapped yet', {})
    }
    const now = this.deps.clock.now()
    const row: ClientRow = {
      id: this.deps.ids.next(),
      organizationId,
      name: input.client_name,
      redirectUris: input.redirect_uris,
      clientUri: input.client_uri ?? null,
      createdAt: now
    }
    await this.deps.oauth.insertClient(row)
    return {
      client_id: row.id,
      client_id_issued_at: Math.floor(now.getTime() / 1_000),
      client_name: row.name,
      redirect_uris: input.redirect_uris,
      ...(input.client_uri ? { client_uri: input.client_uri } : {}),
      token_endpoint_auth_method: 'none' as const,
      grant_types: input.grant_types,
      response_types: input.response_types
    }
  }

  /** What the consent page shows; a redirect the client did not register is refused before anything. */
  async consentClient(caller: Caller, clientId: string, redirectUri: string) {
    const person = await this._person(caller)
    const client = await this._client(clientId, redirectUri)
    return {
      id: client.id,
      name: client.name,
      redirectHost: hostOf(redirectUri),
      clientUri: client.clientUri,
      connected: Boolean(await this.deps.oauth.liveConnection(client.id, person.id))
    }
  }

  /** The person's answer: back to the client with a code, or with `access_denied`. */
  async authorize(caller: Caller, input: Authorize, issuer: string): Promise<{ redirectTo: string }> {
    const person = await this._person(caller)
    const client = await this._client(input.clientId, input.redirectUri)
    if (input.scope && !input.scope.split(' ').every((scope) => scope === MCP_SCOPE)) {
      return { redirectTo: _back(input, { error: 'invalid_scope', iss: issuer }) }
    }
    if (!input.allow) {
      return { redirectTo: _back(input, { error: 'access_denied', iss: issuer }) }
    }
    await this._connect(person, client)
    const code = newCode()
    await this.deps.oauth.insertCode({
      hash: digest(code),
      clientId: client.id,
      personId: person.id,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource ?? null,
      scope: MCP_SCOPE,
      expiresAt: new Date(this.deps.clock.now().getTime() + CODE_MS),
      usedAt: null
    })
    return { redirectTo: _back(input, { code, iss: issuer }) }
  }

  async token(input: TokenRequest): Promise<TokenAnswer> {
    const client = await this.deps.oauth.client(input.client_id)
    if (!client) {
      return _refuse('invalid_client', `Client "${input.client_id}" is not registered`, 401)
    }
    return input.grant_type === 'authorization_code'
      ? await this._exchange(client, input)
      : await this._refresh(client, input)
  }

  private async _exchange(client: ClientRow, input: Extract<TokenRequest, { grant_type: 'authorization_code' }>) {
    const code = await this.deps.oauth.useCode(digest(input.code), this.deps.clock.now())
    const problem = _codeProblem(code, client, input, this.deps.clock.now())
    if (problem || !code) {
      return _refuse('invalid_grant', problem ?? 'The code is unknown')
    }
    const connection = await this.deps.oauth.liveConnection(client.id, code.personId)
    if (!connection) {
      return _refuse('invalid_grant', 'The person ended this connection')
    }
    const body = await this.deps.db.transaction(async (tx) => await this.deps.tokens.issue(tx, connection))
    return { status: 200 as const, body }
  }

  /** Rotation: the old refresh token dies with this use; one used twice ends the connection. */
  private async _refresh(client: ClientRow, input: Extract<TokenRequest, { grant_type: 'refresh_token' }>) {
    const hash = digest(input.refresh_token)
    const token = await this.deps.oauth.token(hash)
    const connection = token ? await this.deps.oauth.connection(token.connectionId) : undefined
    const now = this.deps.clock.now()
    if (token?.kind !== 'refresh' || !connection || connection.clientId !== client.id || connection.revokedAt) {
      return _refuse('invalid_grant', 'The refresh token is unknown or its connection ended')
    }
    if (token.revokedAt) {
      await this.deps.db.transaction(async (tx) => await this.deps.oauth.revokeConnection(tx, connection.id, now))
      return _refuse('invalid_grant', 'The refresh token was already used; the connection is ended')
    }
    if (token.expiresAt <= now) {
      return _refuse('invalid_grant', 'The refresh token expired')
    }
    return await this._rotate(hash, connection, now)
  }

  private async _rotate(hash: string, connection: ConnectionRow, now: Date): Promise<TokenAnswer> {
    const body = await this.deps.db.transaction(async (tx) => {
      if (!(await this.deps.oauth.revokeToken(tx, hash, now))) {
        return undefined
      }
      return await this.deps.tokens.issue(tx, connection)
    })
    return body ? { status: 200, body } : _refuse('invalid_grant', 'The refresh token was already used')
  }

  /** This person's connection to the client, made on their first consent (ADR-0022). */
  private async _connect(person: MemberRow, client: ClientRow): Promise<ConnectionRow> {
    const live = await this.deps.oauth.liveConnection(client.id, person.id)
    if (live) {
      return live
    }
    const row: ConnectionRow = {
      id: this.deps.ids.next(),
      organizationId: client.organizationId,
      clientId: client.id,
      personId: person.id,
      scope: MCP_SCOPE,
      createdAt: this.deps.clock.now(),
      lastUsedAt: null,
      revokedAt: null
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.oauth.insertConnection(tx, row)
      await this._audit(tx, person, row.id, { application: client.name })
    })
    return row
  }

  private async _audit(tx: Database, actor: MemberRow, entityId: string, values: Record<string, string>) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'oauth_connection',
      entityId,
      action: 'allowed',
      changes: Object.fromEntries(Object.entries(values).map(([field, after]) => [field, { before: null, after }]))
    })
  }

  private async _client(clientId: string, redirectUri: string): Promise<ClientRow> {
    const client = await this.deps.oauth.client(clientId)
    if (!client) {
      throw new NotFoundException('OAuth client', clientId)
    }
    if (!(client.redirectUris as string[]).includes(redirectUri)) {
      throw new ValidationException(`Redirect "${redirectUri}" is not one client "${client.name}" registered`, {
        redirectUri
      })
    }
    return client
  }

  /** Only a person allows an application, signed in to the panel — never a token. */
  private async _person(caller: Caller): Promise<MemberRow> {
    const actor = await this.deps.access.actor(caller)
    if (actor.kind !== 'person' || caller.memberId) {
      throw new ForbiddenException('Only a person signed in to JiraIA allows an application', { memberId: actor.id })
    }
    return actor
  }
}

/** Why a code cannot be exchanged, or nothing when it can. */
const _codeProblem = (
  code: Awaited<ReturnType<OAuthRepository['useCode']>>,
  client: ClientRow,
  input: Extract<TokenRequest, { grant_type: 'authorization_code' }>,
  now: Date
): string | undefined => {
  if (!code) {
    return 'The code is unknown or was already used'
  }
  if (code.expiresAt <= now) {
    return 'The code expired'
  }
  if (code.clientId !== client.id || code.redirectUri !== input.redirect_uri) {
    return 'The code was issued to another client or redirect'
  }
  if (code.resource && input.resource && code.resource !== input.resource) {
    return 'The code was issued for another resource'
  }
  return pkceMatches(input.code_verifier, code.codeChallenge) ? undefined : 'The code verifier does not match'
}

/** The redirect back to the client, with the answer and the client's own `state`. */
const _back = (input: Pick<Authorize, 'redirectUri' | 'state'>, values: Record<string, string>): string => {
  const url = new URL(input.redirectUri)
  for (const [name, value] of Object.entries({ ...values, ...(input.state ? { state: input.state } : {}) })) {
    url.searchParams.set(name, value)
  }
  return url.toString()
}
