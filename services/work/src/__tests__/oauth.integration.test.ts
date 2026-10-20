import { beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Etapa 6c (ADR-0021): an MCP client connects by OAuth — discovery, registration, a person's consent,
 * PKCE, rotating refresh tokens — and acts as the application's agent for that person. The official
 * SDK runs the client side, its fetch answered by the router.
 */
const db = await testDatabase('services/work/drizzle')
const BASE = 'http://jiraia.local'
const REDIRECT = 'http://localhost:33418/callback'
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime',
  API_URL: BASE,
  WEB_URL: 'http://panel.local'
}
let now = new Date('2026-10-19T12:00:00Z')
const clock = { now: () => new Date(now) }

let service: ReturnType<typeof buildService>
let spaceId: string

type Result = { status: number; body: unknown; headers: Record<string, string> }

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')

const ok = async <T>(call: Promise<{ status: number; body: unknown }>, status = 200): Promise<T> => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as T
}

const _method = (input: string | URL | Request, init?: RequestInit) =>
  (init?.method ?? (input instanceof Request ? input.method : 'GET')) as Call['method']

const _body = (init?: RequestInit): string | undefined =>
  typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : undefined

/** fetch, answered by the router — the request's path, headers and body become the event. */
const routerFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const event = apiEvent({ method: _method(input, init), path: url.pathname })
  const headers = Object.fromEntries(
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : {})).entries()
  )
  const body = _body(init)
  const result = await service.router({
    ...event,
    headers: { ...event.headers, ...headers },
    ...(body ? { body } : {})
  })
  return new Response(result.body ?? null, {
    status: result.statusCode ?? 200,
    headers: (result.headers ?? {}) as Record<string, string>
  })
}

const send = async (path: string, init: RequestInit = {}): Promise<Result> => {
  const response = await routerFetch(`${BASE}${path}`, init)
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    headers: Object.fromEntries(response.headers)
  }
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString()
})

const pkce = () => {
  const verifier = `v${'x'.repeat(50)}${Math.random().toString(36).slice(2)}`
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

const register = async (redirect = REDIRECT) =>
  (
    await send('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Minha Plataforma', redirect_uris: [redirect] })
    })
  ).body as { client_id: string }

/** A person allows the client on the consent page; the answer is the redirect with the code. */
const consent = async (who: typeof ana, clientId: string, challenge: string, allow = true) => {
  const body = {
    clientId,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state: 'xyz',
    allow
  }
  return new URL(
    (await ok<{ redirectTo: string }>(who({ method: 'POST', path: '/oauth/authorizations', body }))).redirectTo
  )
}

type Tokens = { access_token: string; refresh_token: string }

/** Registration, consent and the code exchange, by hand. */
const connect = async (who = ana) => {
  const { client_id } = await register()
  const { verifier, challenge } = pkce()
  const code = (await consent(who, client_id, challenge)).searchParams.get('code') ?? ''
  const tokens = await send(
    '/oauth/token',
    form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id, redirect_uri: REDIRECT })
  )
  return { clientId: client_id, ...(tokens.body as Tokens) }
}

const mcp = (token: string, body: unknown) =>
  send('/v1/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

beforeEach(async () => {
  await truncateSchema(db, 'work')
  now = new Date('2026-10-19T12:00:00Z')
  service = buildService(config, { db, clock })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  spaceId = (
    await ok<{ id: string }>(
      admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Produto', type: 'business' } }),
      201
    )
  ).id
  await ok(admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title: 'Contrato Acme' } }), 201)
  await ok(admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }), 201)
  await ok(admin({ method: 'POST', path: '/members', body: { email: 'bia@uselets.com', name: 'Bia' } }), 201)
})

describe('the SDK client', () => {
  it('discovers, registers, sends the person to consent and writes as them, via the application', async () => {
    let verifier = ''
    let saved: Tokens | undefined
    let client: { client_id: string } | undefined
    let consentUrl: URL | undefined
    const provider: OAuthClientProvider = {
      redirectUrl: REDIRECT,
      clientMetadata: { client_name: 'Minha Plataforma', redirect_uris: [REDIRECT] },
      clientInformation: () => client,
      saveClientInformation: (info) => {
        client = info
      },
      tokens: () => saved as never,
      saveTokens: (tokens) => {
        saved = tokens as Tokens
      },
      redirectToAuthorization: (url) => {
        consentUrl = url
      },
      saveCodeVerifier: (value) => {
        verifier = value
      },
      codeVerifier: () => verifier
    }
    const open = () =>
      new StreamableHTTPClientTransport(new URL(`${BASE}/v1/mcp`), { authProvider: provider, fetch: routerFetch })

    const first = open()
    await expect(new Client({ name: 'app', version: '1' }).connect(first as never)).rejects.toThrow()
    expect(consentUrl?.origin).toBe('http://panel.local')
    expect(consentUrl?.pathname).toBe('/oauth/autorizar')
    const params = consentUrl?.searchParams as URLSearchParams
    const back = await consent(ana, params.get('client_id') ?? '', params.get('code_challenge') ?? '')
    await first.finishAuth(back.searchParams.get('code') ?? '')

    const connected = new Client({ name: 'app', version: '1' })
    await connected.connect(open() as never)
    const tools = (await connected.listTools()).tools.map((tool) => tool.name)
    expect(tools).toContain('create_card')
    expect(tools).not.toContain('propose_changes')
    await connected.callTool({ name: 'comment_on_card', arguments: { card: 'PRD-1', body: 'Feito pela Laís' } })
    const card = await ok<{ id: string }>(admin({ method: 'GET', path: '/cards/by-key/PRD-1' }))
    const comments = await ok<{ items: { body: string; author: { name: string } }[] }>(
      admin({ method: 'GET', path: `/cards/${card.id}/comments` })
    )
    expect(comments.items).toMatchObject([{ body: 'Feito pela Laís', author: { name: 'Ana' } }])
    const history = await ok<{ items: { action: string; via: string | null }[] }>(
      admin({ method: 'GET', path: `/cards/${card.id}/history` })
    )
    expect(history.items.find((event) => event.action === 'commented')?.via).toBe('Minha Plataforma')
  })
})

describe('discovery', () => {
  it('points a client from the 401 to the documents', async () => {
    const refused = await mcp('nothing', { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(refused.status).toBe(401)
    expect(refused.headers['www-authenticate']).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource"`
    )
    expect((await send('/.well-known/oauth-protected-resource/v1/mcp')).body).toMatchObject({
      resource: `${BASE}/v1/mcp`,
      authorization_servers: [BASE]
    })
    expect((await send('/.well-known/oauth-authorization-server')).body).toMatchObject({
      issuer: BASE,
      authorization_endpoint: 'http://panel.local/oauth/autorizar',
      code_challenge_methods_supported: ['S256']
    })
  })
})

describe('registration and consent', () => {
  it('accepts https or loopback redirects only', async () => {
    const refused = await send('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'X', redirect_uris: ['http://evil.example/cb'] })
    })
    expect(refused.status).toBe(400)
  })

  it('shows the client to the person, refuses a redirect it did not register, and denies on request', async () => {
    const { client_id } = await register()
    expect(
      await ok(ana({ method: 'GET', path: '/oauth/consent', query: { client_id, redirect_uri: REDIRECT } }))
    ).toMatchObject({ name: 'Minha Plataforma', redirectHost: 'localhost:33418', connected: false })
    const elsewhere = await ana({
      method: 'GET',
      path: '/oauth/consent',
      query: { client_id, redirect_uri: 'https://evil.example/cb' }
    })
    expect(elsewhere.status).toBe(400)
    const denied = await consent(ana, client_id, pkce().challenge, false)
    expect(Object.fromEntries(denied.searchParams)).toEqual({ error: 'access_denied', iss: BASE, state: 'xyz' })
  })

  it('is for a person signed in, never for a token', async () => {
    const { value } = await ok<{ value: string }>(ana({ method: 'POST', path: '/me/tokens', body: { name: 'x' } }), 201)
    const { client_id } = await register()
    const viaToken = await send('/v1/oauth/authorizations', {
      method: 'POST',
      headers: { authorization: `Bearer ${value}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: client_id,
        redirectUri: REDIRECT,
        codeChallenge: pkce().challenge,
        codeChallengeMethod: 'S256',
        allow: true
      })
    })
    expect(viaToken.status).toBe(403)
  })
})

describe('the code and the tokens', () => {
  it('exchange a code once, with the matching verifier only', async () => {
    const { client_id } = await register()
    const { verifier, challenge } = pkce()
    const code = (await consent(ana, client_id, challenge)).searchParams.get('code') ?? ''
    const exchange = (codeVerifier: string) =>
      send(
        '/oauth/token',
        form({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, client_id, redirect_uri: REDIRECT })
      )

    expect((await exchange(pkce().verifier)).body).toMatchObject({ error: 'invalid_grant' })
    // The wrong verifier spent the code: a code is tried once.
    expect((await exchange(verifier)).body).toMatchObject({ error: 'invalid_grant' })
  })

  it('give an access token that opens MCP only, as the person', async () => {
    const { access_token } = await connect()
    const answered = await mcp(access_token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_card', arguments: { card: 'PRD-1' } }
    })
    expect(answered.body).toMatchObject({ result: { isError: false } })
    const elsewhere = await send('/v1/me', { headers: { authorization: `Bearer ${access_token}` } })
    expect(elsewhere.status).toBe(403)
  })

  it('refresh by rotation, and a refresh token used twice ends the connection', async () => {
    const { clientId, refresh_token } = await connect()
    const refresh = (token: string) =>
      send('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId }))
    const next = (await refresh(refresh_token)).body as Tokens
    expect(next.access_token).toMatch(/^jioa_/)
    expect((await refresh(refresh_token)).body).toMatchObject({ error: 'invalid_grant' })
    expect((await mcp(next.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })

  it('stop after an hour, and when the person revokes the connection', async () => {
    const { access_token } = await connect()
    const { items } = await ok<{ items: { id: string; application: { name: string } }[] }>(
      ana({ method: 'GET', path: '/me/connections' })
    )
    expect(items).toMatchObject([{ application: { name: 'Minha Plataforma' } }])
    await ok(ana({ method: 'DELETE', path: `/me/connections/${items[0]?.id}` }), 204)
    expect((await mcp(access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)

    const again = await connect()
    now = new Date(now.getTime() + 3_601_000)
    expect((await mcp(again.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })
})

describe('acting as the person', () => {
  it('writes only where the person writes, and stops when the person is deactivated', async () => {
    const forAna = await connect(ana)
    const create = () =>
      mcp(forAna.access_token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_card', arguments: { space: 'PRD', title: 'Pela Laís' } }
      })
    expect(((await create()).body as { result: { isError: boolean } }).result.isError).toBe(true)

    const members = await ok<{ items: { id: string; email: string }[] }>(admin({ method: 'GET', path: '/members' }))
    const anaId = members.items.find((member) => member.email === 'ana@uselets.com')?.id
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${anaId}`, body: { role: 'member' } }))
    const created = (await create()).body as { result: { isError: boolean; structuredContent: { id: string } } }
    expect(created.result.isError).toBe(false)
    const card = await ok<{ reporter: { id: string } }>(
      admin({ method: 'GET', path: `/cards/${created.result.structuredContent.id}` })
    )
    expect(card.reporter.id).toBe(anaId as string)

    await ok(admin({ method: 'POST', path: `/members/${anaId}/deactivate` }))
    expect((await create()).status).toBe(401)
  })
})
