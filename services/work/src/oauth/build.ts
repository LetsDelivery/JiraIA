import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import { AuthorizationServer } from './authorization-server.js'
import { OAuthRepository } from './oauth.repository.js'
import { OAuthTokens } from './oauth-tokens.js'

type OAuthDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
}

/** OAuth for MCP clients (Etapa 6c, ADR-0021): the authorization server and the tokens it issues. */
export const buildOAuth = (deps: OAuthDeps) => {
  const oauth = new OAuthRepository(deps.db)
  const tokens = new OAuthTokens({ ...deps, oauth })
  return { tokens, server: new AuthorizationServer({ ...deps, oauth, tokens }) }
}
