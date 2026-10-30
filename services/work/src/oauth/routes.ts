import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'

import type { AuthorizationServer } from './authorization-server.js'
import { authorizationServerMetadata, protectedResourceMetadata, publicBase } from './metadata.js'
import type { OAuthTokens } from './oauth-tokens.js'
import {
  authorizeAnswerSchema,
  authorizeSchema,
  connectionListSchema,
  connectionPathSchema,
  consentClientSchema,
  consentQuerySchema,
  metadataSchema,
  registerClientSchema,
  registeredClientSchema,
  tokenAnswerSchema,
  tokenRequestSchema
} from './schemas.js'

type Parts = { server: AuthorizationServer; tokens: OAuthTokens; apiUrl: string | undefined; webUrl: string }

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * Where clients look for the documents (RFC 8414, RFC 9728): at the root, and with the path of the
 * issuer or the resource after it — `/work` and `/work/v1/mcp` locally, `/api/work/v1/mcp` behind
 * the panel's domain in AWS.
 */
const WELL_KNOWN_SUFFIXES = ['', '/{a}', '/{a}/{b}', '/{a}/{b}/{c}', '/{a}/{b}/{c}/{d}']

const wellKnown = (name: string, document: (base: string) => Record<string, unknown>, apiUrl?: string): Route[] =>
  WELL_KNOWN_SUFFIXES.map((suffix) =>
    defineRoute({
      method: 'GET',
      path: `/.well-known/${name}${suffix}`,
      requires: 'public',
      schemas: {},
      responds: metadataSchema,
      handler: async ({ headers }) => ({ statusCode: 200, body: document(publicBase(apiUrl, headers)) })
    })
  )

const discoveryRoutes = ({ apiUrl, webUrl }: Parts): Route[] => [
  ...wellKnown('oauth-protected-resource', protectedResourceMetadata, apiUrl),
  ...wellKnown('oauth-authorization-server', (base) => authorizationServerMetadata(base, webUrl), apiUrl)
]

/** What a client calls by itself, with no person and no token: registering, and the token endpoint. */
const clientRoutes = ({ server }: Parts): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/oauth/register',
    requires: 'public',
    schemas: { body: registerClientSchema },
    responds: registeredClientSchema,
    handler: async ({ body }) => ({ statusCode: 201, body: await server.register(body), headers: NO_STORE })
  }),
  defineRoute({
    method: 'POST',
    path: '/oauth/token',
    requires: 'public',
    schemas: { body: z.record(z.string(), z.unknown()) },
    responds: tokenAnswerSchema,
    handler: async ({ body }) => {
      const request = tokenRequestSchema.safeParse(body)
      const answer = request.success
        ? await server.token(request.data)
        : { status: 400, body: { error: 'invalid_request', error_description: request.error.issues[0]?.message ?? '' } }
      return { statusCode: answer.status, body: answer.body, headers: NO_STORE }
    }
  })
]

/** What the panel calls for the signed-in person: the consent page, and their connected applications. */
const personRoutes = ({ server, tokens, apiUrl }: Parts): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/oauth/consent',
    requires: 'authenticated',
    schemas: { query: consentQuerySchema },
    responds: consentClientSchema,
    handler: async ({ caller, query }) => ({
      statusCode: 200,
      body: await server.consentClient(caller, query.client_id, query.redirect_uri)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/oauth/authorizations',
    requires: 'authenticated',
    schemas: { body: authorizeSchema },
    responds: authorizeAnswerSchema,
    handler: async ({ caller, body, headers }) => ({
      statusCode: 200,
      body: await server.authorize(caller, body, publicBase(apiUrl, headers))
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/me/connections',
    requires: 'authenticated',
    schemas: {},
    responds: connectionListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await tokens.mine(caller) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/me/connections/{connectionId}',
    requires: 'authenticated',
    schemas: { path: connectionPathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await tokens.revoke(caller, path.connectionId)
      return { statusCode: 204 }
    }
  })
]

/** OAuth for MCP clients (Etapa 6c, ADR-0021). */
export const oauthRoutes = (parts: Parts): Route[] => [
  ...discoveryRoutes(parts),
  ...clientRoutes(parts),
  ...personRoutes(parts)
]
