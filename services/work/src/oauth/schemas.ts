import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { oauthClients, oauthCodes, oauthConnections, oauthTokens } from '../schema-agents.js'

export type ClientRow = typeof oauthClients.$inferSelect
export type CodeRow = typeof oauthCodes.$inferSelect
export type ConnectionRow = typeof oauthConnections.$inferSelect
export type TokenRow = typeof oauthTokens.$inferSelect

/** The one scope: read what the person reads, and propose changes a person approves (ADR-0021). */
export const MCP_SCOPE = 'mcp'

/** `https`, or `http` on the machine itself — where a desktop client listens for the answer. */
const redirectUriSchema = z
  .url()
  .max(2_000)
  .refine((uri) => {
    const url = new URL(uri)
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  }, 'A redirect address is https, or http on localhost')
  .refine((uri) => !new URL(uri).hash, 'A redirect address has no fragment')

/** What a client sends to register itself (RFC 7591); anything else it sends is ignored. */
export const registerClientSchema = z.object({
  client_name: z.string().trim().min(1).max(100).default('Aplicativo'),
  redirect_uris: z.array(redirectUriSchema).min(1).max(10),
  client_uri: z.url().max(2_000).optional(),
  token_endpoint_auth_method: z.literal('none').default('none'),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .default(['authorization_code', 'refresh_token']),
  response_types: z.array(z.literal('code')).default(['code'])
})
export type RegisterClient = z.infer<typeof registerClientSchema>

export const registeredClientSchema = z.object({
  client_id: z.uuid(),
  client_id_issued_at: z.number().int(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  client_uri: z.string().optional(),
  token_endpoint_auth_method: z.literal('none'),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string())
})

/** What the consent page asks before showing anything: is this client real, and is this its address? */
export const consentQuerySchema = z.object({ client_id: z.uuid(), redirect_uri: z.string().min(1) })
export const consentClientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  redirectHost: z.string(),
  clientUri: z.string().nullable(),
  /** Whether this person already allowed it — the page then says so. */
  connected: z.boolean()
})

/** The person's answer on the consent page, with the request the client made. */
export const authorizeSchema = z.object({
  clientId: z.uuid(),
  redirectUri: z.string().min(1),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  codeChallengeMethod: z.literal('S256'),
  state: z.string().max(2_000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.url().optional(),
  allow: z.boolean()
})
export type Authorize = z.infer<typeof authorizeSchema>
export const authorizeAnswerSchema = z.object({ redirectTo: z.string() })

/** The token endpoint's form (RFC 6749), either grant. */
export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    client_id: z.uuid(),
    redirect_uri: z.string().min(1),
    resource: z.string().optional()
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id: z.uuid(),
    resource: z.string().optional()
  })
])
export type TokenRequest = z.infer<typeof tokenRequestSchema>

export const tokenAnswerSchema = z.union([
  z.object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int(),
    refresh_token: z.string(),
    scope: z.string()
  }),
  z.object({ error: z.string(), error_description: z.string() })
])

export const connectionViewSchema = z.object({
  id: z.uuid(),
  application: z.object({ id: z.uuid(), name: z.string(), redirectHost: z.string() }),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable()
})
export type ConnectionView = z.infer<typeof connectionViewSchema>
export const connectionListSchema = z.object({ items: z.array(connectionViewSchema) })
export const connectionPathSchema = z.object({ connectionId: z.uuid() })

export const toConnectionView = (row: ConnectionRow, client: ClientRow): ConnectionView => ({
  id: row.id,
  application: { id: client.id, name: client.name, redirectHost: hostOf((client.redirectUris as string[])[0] ?? '') },
  createdAt: toIso(row.createdAt),
  lastUsedAt: row.lastUsedAt ? toIso(row.lastUsedAt) : null
})

/** The host a redirect sends the person to — what they judge the application by. */
export const hostOf = (uri: string): string => {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export const metadataSchema = z.record(z.string(), z.unknown())
