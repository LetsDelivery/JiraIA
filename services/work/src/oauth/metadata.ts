import { MCP_SCOPE } from './schemas.js'

/**
 * The API's public address: the configured one, or the one the request came to — never with a slash
 * at the end.
 *
 * @example publicBase(undefined, { host: 'api.jiraia.dev' })   // 'https://api.jiraia.dev'
 */
export const publicBase = (configured: string | undefined, headers: Readonly<Record<string, string | undefined>>) => {
  const base = configured ?? `${headers['x-forwarded-proto'] ?? 'https'}://${headers.host ?? 'localhost'}`
  return base.replace(/\/+$/, '')
}

/** The MCP endpoint, as a token's audience (RFC 8707) and the protected resource. */
export const mcpResource = (base: string): string => `${base}/v1/mcp`

/** RFC 9728: where the MCP endpoint's tokens come from. */
export const protectedResourceMetadata = (base: string) => ({
  resource: mcpResource(base),
  authorization_servers: [base],
  scopes_supported: [MCP_SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'JiraIA'
})

/** RFC 8414: how to register, send a person to consent, and exchange the code (ADR-0021). */
export const authorizationServerMetadata = (base: string, webUrl: string) => ({
  issuer: base,
  authorization_endpoint: `${webUrl.replace(/\/+$/, '')}/oauth/autorizar`,
  token_endpoint: `${base}/oauth/token`,
  registration_endpoint: `${base}/oauth/register`,
  scopes_supported: [MCP_SCOPE],
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true
})

/** What a 401 on the MCP endpoint says, so a client finds where to sign in. */
export const mcpChallenge = (base: string): string =>
  `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`
