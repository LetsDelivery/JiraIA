import { randomUUID } from 'node:crypto'
import { ForbiddenException, NotFoundException, UnauthenticatedException, ValidationException } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2
} from 'aws-lambda'
import type { z } from 'zod'

import { anonymousCaller, type Caller, callerFromClaims } from './caller.js'
import { compressed } from './compress.js'
import type { IdentityVerifier } from './identity.js'
import { matchRoute } from './match.js'
import { noContent, ok, toResponse } from './response.js'
import type { HttpMethod, Requirement, Route } from './route.js'

/**
 * The single HTTP entry point of a service (one router per bounded context, ADR-0003).
 *
 * The router only proves *who* is calling. *What* they may do depends on the space or project the
 * request is about, and is decided by the service (ADR-0004).
 */
export type RouterDeps = {
  routes: readonly Route[]
  logger: JiraiaLogger
  /** Proves an API token on `/v1/…` (ADR-0015); without it those paths answer 401. */
  tokens?: TokenVerifier
  /**
   * Proves a sign-in token everywhere else: the Cognito ID token of a person who signed in with Google
   * (ADR-0026). Without it, only the claims of a gateway authorizer admit a caller — which is how the
   * local harness and the tests call.
   */
  identity?: IdentityVerifier
  /**
   * The `WWW-Authenticate` a 401 on this path carries, if any — how an MCP client finds where to sign
   * in (ADR-0021). The path is the route's, without `/v1`.
   */
  challenge?: (path: string, headers: Readonly<Record<string, string | undefined>>) => string | undefined
}

/** The service's check of an API token: the caller it stands for, or nothing when it is not valid. */
export type TokenVerifier = { verify(token: string): Promise<Caller | undefined> }

/** Where API tokens are accepted: the same routes, under this prefix, where no sign-in token counts. */
export const TOKEN_PATH_PREFIX = '/v1'

const _parse = <TSchema extends z.ZodType>(schema: TSchema, value: unknown, where: string): z.infer<TSchema> => {
  const result = schema.safeParse(value)

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || where}: ${issue.message}`)
    throw new ValidationException(`Invalid ${where} — ${issues.join('; ')}`, { issues })
  }

  return result.data
}

/** A form body, as OAuth's token endpoint receives one (RFC 6749): its fields as strings. */
const _isForm = (event: APIGatewayProxyEventV2): boolean =>
  (event.headers?.['content-type'] ?? event.headers?.['Content-Type'] ?? '').startsWith(
    'application/x-www-form-urlencoded'
  )

const _readBody = (event: APIGatewayProxyEventV2): unknown => {
  if (!event.body) {
    return undefined
  }

  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  if (_isForm(event)) {
    return Object.fromEntries(new URLSearchParams(raw).entries())
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new ValidationException('The request body is not valid JSON, expected an object', {
      length: raw.length
    })
  }
}

/**
 * Validates whichever of body, path and query the route declared, and nothing it did not.
 *
 * A route with no `body` schema gets `undefined` rather than an unvalidated object: a handler
 * must not be able to reach input the route never said it accepts.
 */
const _validate = (route: Route, event: APIGatewayProxyEventV2, params: Record<string, string>) => ({
  body: route.schemas.body ? _parse(route.schemas.body, _readBody(event), 'body') : undefined,
  path: route.schemas.path ? _parse(route.schemas.path, params, 'path') : undefined,
  query: route.schemas.query ? _parse(route.schemas.query, event.queryStringParameters ?? {}, 'query') : undefined
})

/** The bearer token of a request, or an empty string when it carries none. */
const _bearer = (event: APIGatewayProxyEventV2): string => {
  const header = event.headers?.authorization ?? event.headers?.Authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
}

/**
 * The caller behind a request outside `/v1`: a person signed in with Google, through Cognito.
 *
 * Claims a gateway authorizer already verified are trusted — no client can write `requestContext`,
 * and the local harness and the tests stand in for an authorizer that way. With none, the bearer
 * token is verified here (ADR-0025, ADR-0026). Their *absence* on a non-public route is not a 403 but a 401:
 * no decision could be taken, rather than a decision that came out negative.
 */
const _resolveCaller = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  requirement: Requirement,
  identity: IdentityVerifier | undefined
): Promise<Caller> => {
  if (requirement === 'public') {
    return anonymousCaller
  }
  const claims = event.requestContext.authorizer?.jwt?.claims
  if (claims) {
    return callerFromClaims(claims)
  }
  const token = _bearer(event)
  const caller = token && identity ? await identity.verify(token) : undefined
  if (!caller) {
    throw new UnauthenticatedException('The request carries no valid sign-in token')
  }
  return caller
}

/**
 * The caller behind a request on `/v1/…`: only an API token the service verifies admits it
 * (ADR-0015). Google claims never count here.
 */
const _resolveTokenCaller = async (
  event: APIGatewayProxyEventV2,
  requirement: Requirement,
  tokens: TokenVerifier | undefined
): Promise<Caller> => {
  if (requirement === 'public') {
    return anonymousCaller
  }
  const token = _bearer(event)
  const caller = token && tokens ? await tokens.verify(token) : undefined
  if (!caller) {
    throw new UnauthenticatedException('The request carries no valid API token')
  }
  return caller
}

/** Header names lowercased, as HTTP treats them; API Gateway v2 already sends them so. */
const _headers = (event: APIGatewayProxyEventV2): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(event.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))

/**
 * Whether the request came by `/v1`, and the route path without it.
 *
 * @example _splitTokenPath('/v1/spaces')   // { viaToken: true, path: '/spaces' }
 */
const _splitTokenPath = (requested: string): { viaToken: boolean; path: string } => {
  const viaToken = requested === TOKEN_PATH_PREFIX || requested.startsWith(`${TOKEN_PATH_PREFIX}/`)
  return { viaToken, path: viaToken ? requested.slice(TOKEN_PATH_PREFIX.length) || '/' : requested }
}

/**
 * Off in production, on wherever `VALIDATE_RESPONSES=1` — the local harness and the test suite.
 *
 * Nothing parses a response on the way out in production: the handler built it from the same schemas
 * the repository reads, and paying to re-validate every list of two hundred cards would buy
 * nothing. What it *does* buy in development is the one failure `responds:` cannot catch by itself —
 * a handler that quietly stops matching what it says it returns, which reaches a front end as a
 * generated type that is confidently wrong.
 *
 * It throws rather than warns. A warning in a log nobody is reading is how the declaration and the
 * handler drift apart in the first place.
 */
const VALIDATE = process.env.VALIDATE_RESPONSES === '1'

const _assertRespondsAsDeclared = (route: Route, body: unknown, logger: JiraiaLogger): void => {
  if (!VALIDATE || !route.responds || body === undefined) {
    return
  }

  const parsed = route.responds.safeParse(body)

  if (parsed.success) {
    return
  }

  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)

  logger.error('A handler answered something other than what its route declares', {
    route: `${route.method} ${route.path}`,
    issues
  })

  throw new Error(
    `${route.method} ${route.path} answered something its \`responds:\` does not describe — ${issues.join('; ')}`
  )
}

/**
 * The response for a request that threw, logged at the level its status deserves.
 *
 * 5xx is ours, 4xx is the caller's. Logging both at error level makes the alarm on the error metric
 * fire on every bad request anyone sends.
 */
const _failed = (error: unknown, traceId: string, logger: JiraiaLogger): APIGatewayProxyStructuredResultV2 => {
  const response = toResponse(error, traceId)
  const log = response.statusCode && response.statusCode >= 500 ? logger.error : logger.warn

  log('Request failed', { statusCode: response.statusCode, error: String(error) })

  return response
}

/**
 * Whether a request is a CORS preflight rather than a call to a route.
 *
 * @example isPreflight(event)   // true for `OPTIONS /spaces`
 */
export const isPreflight = (event: Pick<APIGatewayProxyEventV2, 'requestContext'>): boolean =>
  event.requestContext.http.method === 'OPTIONS'

/**
 * The path the caller asked for, without the stage API Gateway prepends to it.
 *
 * An HTTP API on a named stage — `StageName: dev` — hands the function `/dev/spaces` for a request
 * to `/spaces`, on the execute-api URL and through a custom-domain mapping alike; only a `$default`
 * stage passes the path through untouched (found by the first uselets deploy). The local harness
 * reports a stage it never prefixes, so the prefix is removed only when it is actually there.
 *
 * @example requestPath(event)   // '/spaces' for stage 'dev' and path '/dev/spaces'
 */
export const requestPath = (event: Pick<APIGatewayProxyEventV2, 'requestContext'>): string => {
  const { path } = event.requestContext.http
  const stage = event.requestContext.stage

  if (!stage || stage === '$default') {
    return path
  }

  const prefix = `/${stage}`

  if (path === prefix) {
    return '/'
  }

  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path
}

/**
 * @example
 * const router = createRouter({ routes, logger })
 * export const handler = (event) => router(event)
 */
export const createRouter = (deps: RouterDeps) => {
  _assertRoutesAreDeclarative(deps.routes)

  /** Matches, authorizes, validates and calls. Everything that can legitimately throw. */
  const _dispatch = async (
    event: APIGatewayProxyEventV2,
    traceId: string,
    method: HttpMethod,
    requested: string
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const { viaToken, path } = _splitTokenPath(requested)
    const matched = matchRoute(deps.routes, method, path)

    if (!matched) {
      throw new NotFoundException('Route', `${method} ${path}`)
    }

    const { route, params } = matched
    const caller = await _callerFor(route, event, viaToken)

    const result = await route.handler({
      ..._validate(route, event, params),
      caller,
      traceId,
      headers: _headers(event)
    } as never)

    _assertRespondsAsDeclared(route, result.body, deps.logger.child({ traceId }))

    deps.logger.child({ traceId }).info('Request handled', { statusCode: result.statusCode, subject: caller.subject })

    return _toAnswer(result)
  }

  /** Who is calling; an application's OAuth token (ADR-0021) only where the route takes one. */
  const _callerFor = async (route: Route, event: APIGatewayProxyEventV2, viaToken: boolean): Promise<Caller> => {
    const caller = viaToken
      ? await _resolveTokenCaller(event, route.requires, deps.tokens)
      : await _resolveCaller(event as APIGatewayProxyEventV2WithJWTAuthorizer, route.requires, deps.identity)
    if (caller.via && !route.delegated) {
      throw new ForbiddenException(`An application's token does not open ${route.method} ${route.path}`, {
        path: route.path
      })
    }
    return caller
  }

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const traceId = event.requestContext.requestId ?? randomUUID()
    const method = event.requestContext.http.method as HttpMethod
    const path = requestPath(event)
    const logger = deps.logger.child({ traceId, method, path })

    // A CORS preflight is not a request for any route, so it is answered before one is looked up
    // and before any caller is resolved: `ANY /{proxy+}` hands OPTIONS to this function too. The
    // panel calls the API on its own origin, through CloudFront (ADR-0025), so a browser rarely
    // sends one; when it does, an empty 204 is the whole answer.
    if (isPreflight(event)) {
      return noContent()
    }

    try {
      // Compression at the edge of the router, so every route gets it and no handler has to know.
      // API Gateway v2 does not compress anything itself — see `compress.ts`.
      return compressed(await _dispatch(event, traceId, method, path), event)
    } catch (error) {
      return compressed(_challenged(_failed(error, traceId, logger), deps, event), event)
    }
  }
}

/**
 * A handler's result as a response. With nothing to say it keeps its status — 204 for most, 202 for
 * an MCP notification — and a protocol may add a header of its own (OAuth's `Cache-Control: no-store`).
 */
const _toAnswer = (result: { statusCode: number; body?: unknown; headers?: Record<string, string> }) => {
  const answer: APIGatewayProxyStructuredResultV2 =
    result.body === undefined
      ? { statusCode: result.statusCode }
      : { ...ok(result.body), statusCode: result.statusCode }
  return result.headers ? { ...answer, headers: { ...answer.headers, ...result.headers } } : answer
}

/** A 401 tells where to sign in, when the path has somewhere to say (ADR-0021). */
const _challenged = (
  response: APIGatewayProxyStructuredResultV2,
  deps: RouterDeps,
  event: APIGatewayProxyEventV2
): APIGatewayProxyStructuredResultV2 => {
  const path = _splitTokenPath(requestPath(event)).path
  const challenge = response.statusCode === 401 ? deps.challenge?.(path, _headers(event)) : undefined
  return challenge ? { ...response, headers: { ...response.headers, 'www-authenticate': challenge } } : response
}

/**
 * Refuses to build a router whose routes are ambiguous or under-declared.
 *
 * Fail closed, at cold start: nothing else structurally prevents a handler from being registered
 * without saying who may call it.
 * A duplicate route is included because two handlers on one path means one of them is
 * unreachable, and which one depends on declaration order.
 */
const _assertRoutesAreDeclarative = (routes: readonly Route[]): void => {
  const seen = new Set<string>()

  for (const route of routes) {
    const signature = `${route.method} ${route.path}`

    if (seen.has(signature)) {
      throw new Error(`Route "${signature}" is declared more than once; each method and path pair must be unique.`)
    }
    seen.add(signature)

    if (route.requires === undefined) {
      throw new Error(`Route "${signature}" declares no requirement. Use 'public' explicitly if it needs no token.`)
    }
  }
}
