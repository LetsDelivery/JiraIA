import { describe, expect, it } from 'bun:test'

import { ForbiddenException } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'
import { answer, apiEvent } from '@jiraia/testing'
import { z } from 'zod'

import { defineRoute, type Route } from '../route.js'
import { createRouter, requestPath } from '../router.js'

const logger = createLogger('test', 'router')

const routes: Route[] = [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}',
    requires: 'authenticated',
    schemas: { path: z.object({ spaceId: z.uuid() }) },
    responds: z.object({ spaceId: z.string(), subject: z.string() }),
    handler: async ({ path, caller }) => ({ statusCode: 200, body: { spaceId: path.spaceId, subject: caller.subject } })
  }),
  defineRoute({
    method: 'GET',
    path: '/spaces/archived',
    requires: 'public',
    schemas: {},
    responds: z.object({ literal: z.boolean() }),
    handler: async () => ({ statusCode: 200, body: { literal: true } })
  }),
  defineRoute({
    method: 'POST',
    path: '/refuse',
    requires: 'authenticated',
    schemas: {},
    handler: async () => {
      throw new ForbiddenException('No', { action: 'space:manage' })
    }
  }),
  defineRoute({
    method: 'GET',
    path: '/lies',
    requires: 'public',
    schemas: {},
    responds: z.object({ count: z.number() }),
    handler: async () => ({ statusCode: 200, body: { count: 'three' } })
  })
]
const router = createRouter({ routes, logger })
const id = '7a1f4c2e-1111-4a2b-8c3d-123456789abc'

describe('createRouter', () => {
  it('hands the handler the validated path and the caller from the token', async () => {
    const result = answer(await router(apiEvent({ method: 'GET', path: `/spaces/${id}`, subject: 'sub-1' })))

    expect(result).toEqual({ status: 200, body: { spaceId: id, subject: 'sub-1' } })
  })

  it('answers 401 for a non-public route with no token', async () => {
    expect(answer(await router(apiEvent({ method: 'GET', path: `/spaces/${id}` }))).status).toBe(401)
  })

  it('answers 400 naming the field when the path does not validate', async () => {
    const result = answer(await router(apiEvent({ method: 'GET', path: '/spaces/not-a-uuid', subject: 's' })))

    expect(result).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } })
  })

  it('prefers a literal segment over a placeholder, whatever the declaration order', async () => {
    expect(answer(await router(apiEvent({ method: 'GET', path: '/spaces/archived' }))).body).toEqual({ literal: true })
  })

  it('answers 404 for a route nobody declared', async () => {
    expect(answer(await router(apiEvent({ method: 'GET', path: '/nowhere' }))).status).toBe(404)
  })

  it('turns a JiraIA exception into its status and code, with the trace id', async () => {
    const result = answer(await router(apiEvent({ method: 'POST', path: '/refuse', subject: 's' })))

    expect(result).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN', traceId: expect.any(String) } } })
  })

  it('refuses a handler that answers something other than its declared response (VALIDATE_RESPONSES)', async () => {
    expect(answer(await router(apiEvent({ method: 'GET', path: '/lies' }))).status).toBe(500)
  })

  it('refuses at build time a route declared twice', () => {
    expect(() => createRouter({ routes: [routes[1] as Route, routes[1] as Route], logger })).toThrow('more than once')
  })

  it('refuses at build time a route with no requirement', () => {
    const silent = { ...(routes[1] as Route), requires: undefined } as unknown as Route

    expect(() => createRouter({ routes: [silent], logger })).toThrow('declares no requirement')
  })
})

describe('API tokens on /v1', () => {
  const tokenRouter = createRouter({
    routes,
    logger,
    tokens: {
      verify: async (token) =>
        token === 'jia_good' ? { subject: 'token:t1', emailVerified: false, memberId: 'm1' } : undefined
    }
  })
  const withToken = (path: string, token?: string, subject?: string) => {
    const event = apiEvent({ method: 'GET', path, ...(subject ? { subject } : {}) })
    return { ...event, headers: { ...event.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } }
  }

  it('runs the same route for a valid token, as the member it stands for', async () => {
    const result = answer(await tokenRouter(withToken(`/v1/spaces/${id}`, 'jia_good')))
    expect(result).toEqual({ status: 200, body: { spaceId: id, subject: 'token:t1' } })
  })

  it('answers 401 for a token the service does not recognise, or none', async () => {
    expect(answer(await tokenRouter(withToken(`/v1/spaces/${id}`, 'jia_bad'))).status).toBe(401)
    expect(answer(await tokenRouter(withToken(`/v1/spaces/${id}`))).status).toBe(401)
  })

  it('never takes Google claims as a token on /v1', async () => {
    expect(answer(await tokenRouter(withToken(`/v1/spaces/${id}`, undefined, 'sub-1'))).status).toBe(401)
  })

  it('answers 401 on /v1 when the service verifies no tokens', async () => {
    expect(answer(await router(withToken(`/v1/spaces/${id}`, 'jia_good'))).status).toBe(401)
  })
})

describe('what OAuth and MCP need of the router', () => {
  const delegatedRoutes: Route[] = [
    ...routes,
    defineRoute({
      method: 'POST',
      path: '/mcp',
      requires: 'authenticated',
      delegated: true,
      schemas: { body: z.record(z.string(), z.string()) },
      responds: z.object({ fields: z.record(z.string(), z.string()), version: z.string() }),
      handler: async ({ body, headers }) => ({
        statusCode: body.empty ? 202 : 200,
        ...(body.empty ? {} : { body: { fields: body, version: headers['mcp-protocol-version'] ?? '' } }),
        headers: { 'cache-control': 'no-store' }
      })
    })
  ]
  const oauthRouter = createRouter({
    routes: delegatedRoutes,
    logger,
    tokens: {
      verify: async (token) =>
        token === 'jioa_app'
          ? { subject: 'oauth:c1', emailVerified: false, memberId: 'person', via: 'Laís' }
          : undefined
    },
    challenge: (path, headers) => (path === '/mcp' ? `Bearer resource_metadata="https://${headers.host}/x"` : undefined)
  })
  const post = (path: string, token: string, body: string, headers: Record<string, string> = {}) => {
    const event = apiEvent({ method: 'POST', path })
    return { ...event, body, headers: { ...event.headers, authorization: `Bearer ${token}`, ...headers } }
  }

  it('lets an application token reach only routes that take one', async () => {
    const event = apiEvent({ method: 'GET', path: `/v1/spaces/${id}` })
    const elsewhere = { ...event, headers: { ...event.headers, authorization: 'Bearer jioa_app' } }
    expect(answer(await oauthRouter(elsewhere)).status).toBe(403)
    expect(answer(await oauthRouter(post('/v1/mcp', 'jioa_app', '{"a":"1"}'))).status).toBe(200)
  })

  it('reads a form body, hands over the headers, and keeps the status and headers a handler chose', async () => {
    const form = post('/v1/mcp', 'jioa_app', 'grant_type=code&x=1', {
      'content-type': 'application/x-www-form-urlencoded',
      'MCP-Protocol-Version': '2025-06-18'
    })
    const result = await oauthRouter(form)
    expect(answer(result).body).toEqual({ fields: { grant_type: 'code', x: '1' }, version: '2025-06-18' })
    expect(result.headers?.['cache-control']).toBe('no-store')
    expect((await oauthRouter(post('/v1/mcp', 'jioa_app', '{"empty":"1"}'))).statusCode).toBe(202)
  })

  it('tells a refused client where to sign in', async () => {
    const refused = await oauthRouter(post('/v1/mcp', 'nope', '{}', { host: 'api.test' }))
    expect(refused.statusCode).toBe(401)
    expect(refused.headers?.['www-authenticate']).toBe('Bearer resource_metadata="https://api.test/x"')
  })
})

describe('requestPath', () => {
  const event = (path: string, stage: string) => ({ requestContext: { http: { path }, stage } }) as never

  it('removes the named stage API Gateway prepends', () => {
    expect(requestPath(event('/dev/spaces', 'dev'))).toBe('/spaces')
  })

  it('leaves a $default stage path alone', () => {
    expect(requestPath(event('/spaces', '$default'))).toBe('/spaces')
  })
})
