import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

export type Call = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  /** The `sub` the JWT authorizer would have verified, and nothing else. Absent: no token at all. */
  subject?: string
  /** Every claim, for a test about the token itself (see `googleClaims`). Wins over `subject`. */
  claims?: Record<string, string>
  body?: unknown
  query?: Record<string, string>
}

const _claimsOf = (call: Call): Record<string, string> | undefined =>
  call.claims ?? (call.subject ? { sub: call.subject } : undefined)

/**
 * The claims of a Google ID token for a Workspace address, as API Gateway flattens them.
 *
 * The subject is derived from the address so a test can sign in as the same person twice.
 *
 * @example googleClaims('ana@uselets.com')   // { sub: 'google:ana@uselets.com', email, email_verified: 'true', hd: 'uselets.com' }
 */
export const googleClaims = (email: string, overrides: Record<string, string> = {}): Record<string, string> => ({
  sub: `google:${email}`,
  email,
  email_verified: 'true',
  hd: email.split('@')[1] ?? '',
  ...overrides
})

/**
 * An HTTP API (payload v2) event shaped the way API Gateway hands one to a router Lambda.
 *
 * @example await router(apiEvent({ method: 'GET', path: '/spaces', subject: admin.subject }))
 */
export const apiEvent = (call: Call): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    routeKey: `${call.method} ${call.path}`,
    rawPath: call.path,
    rawQueryString: new URLSearchParams(call.query ?? {}).toString(),
    headers: { 'content-type': 'application/json' },
    queryStringParameters: call.query ?? {},
    requestContext: {
      http: { method: call.method, path: call.path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: crypto.randomUUID(),
      stage: '$default',
      ...(_claimsOf(call) ? { authorizer: { jwt: { claims: _claimsOf(call), scopes: [] } } } : {})
    },
    ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    isBase64Encoded: false
  }) as unknown as APIGatewayProxyEventV2

/** The status and the parsed JSON body of a router's answer. */
export const answer = (result: APIGatewayProxyStructuredResultV2): { status: number; body: unknown } => ({
  status: result.statusCode ?? 200,
  body: result.body ? JSON.parse(result.body) : undefined
})
