import { beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Etapa 6b (escopo-mvp 4.9, ADR-0020): the MCP server, reached by the official SDK's client — its fetch
 * handed to the router, so nothing leaves the process — with a service account's token and a person's.
 * Reads follow the caller's access; writes are proposals a person decides.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const clock = { now: () => new Date('2026-10-19T12:00:00Z') }
const MCP_URL = 'http://jiraia.local/v1/mcp'

let service: ReturnType<typeof buildService>
let spaceId: string
let agentToken: string
let anaToken: string

const admin = async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims('admin@uselets.com') })))

const ok = async <T>(call: Promise<{ status: number; body: unknown }>, status = 200): Promise<T> => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as T
}

/** fetch, answered by the router: the URL's path and the request's headers and body become the event. */
const routerFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = (init?.method ?? 'GET') as Call['method']
  const event = apiEvent({ method, path: url.pathname })
  const headers = Object.fromEntries(new Headers(init?.headers).entries())
  const result = await service.router({
    ...event,
    headers: { ...event.headers, ...headers },
    ...(typeof init?.body === 'string' ? { body: init.body } : {})
  })
  return new Response(result.body ?? null, {
    status: result.statusCode ?? 200,
    headers: (result.headers ?? {}) as Record<string, string>
  })
}

/** A raw POST to the endpoint, for what the SDK never sends. */
const raw = async (body: unknown, headers: Record<string, string> = {}, method: Call['method'] = 'POST') => {
  const response = await routerFetch(MCP_URL, {
    method,
    headers: { authorization: `Bearer ${agentToken}`, ...headers },
    body: JSON.stringify(body)
  })
  return { status: response.status, text: await response.text() }
}

const connect = async (token: string) => {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: routerFetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  })
  // The SDK's own types disagree under `exactOptionalPropertyTypes` (its `sessionId?: string`).
  await client.connect(transport as unknown as Parameters<Client['connect']>[0])
  return client
}

type ToolAnswer = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] }
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolAnswer

beforeEach(async () => {
  await truncateSchema(db, 'work')
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
  const agent = await ok<{ id: string }>(
    admin({ method: 'POST', path: '/service-accounts', body: { name: 'Assistente' } }),
    201
  )
  agentToken = (
    await ok<{ value: string }>(
      admin({ method: 'POST', path: `/service-accounts/${agent.id}/tokens`, body: { name: 'MCP' } }),
      201
    )
  ).value
  await ok(admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }), 201)
  anaToken = (
    await ok<{ value: string }>(
      service
        .router(
          apiEvent({
            method: 'POST',
            path: '/me/tokens',
            body: { name: 'MCP' },
            claims: googleClaims('ana@uselets.com')
          })
        )
        .then(answer),
      201
    )
  ).value
})

describe('connecting', () => {
  it('initializes with the SDK client: a person writes at once, an agent proposes', async () => {
    const agent = await connect(agentToken)
    expect(agent.getServerVersion()).toMatchObject({ name: 'jiraia' })
    expect(agent.getInstructions()).toContain('proposal')
    const agentTools = (await agent.listTools()).tools.map((tool) => tool.name)
    expect(agentTools).toEqual(expect.arrayContaining(['get_card', 'query_cards', 'propose_changes']))
    expect(agentTools).not.toContain('create_card')

    const ana = await connect(anaToken)
    const anaTools = (await ana.listTools()).tools.map((tool) => tool.name)
    expect(anaTools).toEqual(expect.arrayContaining(['get_card', 'create_card', 'update_card', 'comment_on_card']))
    expect(anaTools).not.toContain('propose_changes')
    await expect(ana.callTool({ name: 'propose_changes', arguments: {} })).rejects.toThrow(/does not exist/)
  })

  it('answers the transport rules: 202 for notifications, 405 for a stream, 400 for an unknown version', async () => {
    expect((await raw({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    expect((await raw(undefined, {}, 'GET')).status).toBe(405)
    expect(
      (await raw({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' })).status
    ).toBe(400)
    const batch = await raw([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
    expect(JSON.parse(batch.text)).toMatchObject({ error: { code: -32600 } })
    const unknown = await raw({ jsonrpc: '2.0', id: 2, method: 'resources/list' })
    expect(JSON.parse(unknown.text)).toMatchObject({ id: 2, error: { code: -32601 } })
  })

  it('refuses a request without a valid token', async () => {
    const response = await routerFetch(MCP_URL, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    })
    expect(response.status).toBe(401)
  })
})

describe('reading', () => {
  it('lists a space’s sprints and reads the active one with its cards and points (ADR-0029)', async () => {
    const tec = await ok<{ id: string }>(
      admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery', type: 'software' } }),
      201
    )
    const sprint = await ok<{ id: string }>(admin({ method: 'POST', path: `/spaces/${tec.id}/sprints`, body: {} }), 201)
    const card = await ok<{ id: string }>(
      admin({ method: 'POST', path: `/spaces/${tec.id}/cards`, body: { title: 'Rota' } }),
      201
    )
    await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { sprintId: sprint.id, points: 3 } }))
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))

    const client = await connect(agentToken)
    const listed = (await call(client, 'list_sprints', { space: 'TEC' })).structuredContent as {
      items: { name: string; state: string }[]
    }
    expect(listed.items).toEqual([expect.objectContaining({ name: 'Sprint 1', state: 'active' })])
    expect((await call(client, 'get_sprint', { space: 'TEC' })).structuredContent).toMatchObject({
      sprint: { name: 'Sprint 1', committed: { cards: 1, points: 3 } },
      cards: [{ key: 'TEC-1', points: 3, sprintId: sprint.id }]
    })
    expect((await call(client, 'get_sprint', { space: 'PRD' })).isError).toBe(true)
  })

  it('lists spaces, describes one and finds its cards by filter and by text', async () => {
    const client = await connect(agentToken)
    const spaces = (await call(client, 'list_spaces')).structuredContent as { items: { key: string }[] }
    expect(spaces.items.map((space) => space.key)).toEqual(['PRD'])

    const described = (await call(client, 'describe_space', { space: 'prd' })).structuredContent as {
      states: { id: string; group: string }[]
    }
    const first = described.states[0]?.id
    const queried = (await call(client, 'query_cards', { space: 'PRD', filter: { stateIds: [first] } }))
      .structuredContent as { items: { key: string }[] }
    expect(queried.items.map((card) => card.key)).toEqual(['PRD-1'])

    const found = (await call(client, 'search', { query: 'Acme' })).structuredContent as { items: unknown[] }
    expect(found.items).toHaveLength(1)
  })

  it('reads a card with its comments, a page as text, and the members', async () => {
    const client = await connect(agentToken)
    const card = await call(client, 'get_card', { card: 'PRD-1' })
    expect(card.structuredContent).toMatchObject({ card: { key: 'PRD-1', title: 'Contrato Acme' }, comments: [] })

    const draw = await ok<{ id: string }>(
      admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } }),
      201
    )
    const page = await ok<{ id: string }>(
      admin({ method: 'POST', path: `/draw/spaces/${draw.id}/contents`, body: { title: 'Processo de contratos' } }),
      201
    )
    expect((await call(client, 'get_page', { pageId: page.id })).structuredContent).toMatchObject({
      title: 'Processo de contratos',
      kind: 'page'
    })
    const members = (await call(client, 'list_members', { query: 'ana' })).structuredContent as {
      items: { email: string }[]
    }
    expect(members.items.map((member) => member.email)).toEqual(['ana@uselets.com'])
  })

  it('tells the model what went wrong, so it can correct itself', async () => {
    const client = await connect(agentToken)
    const missing = await call(client, 'get_card', { card: 'PRD-99' })
    expect(missing).toMatchObject({ isError: true })
    expect(missing.content[0]?.text).toContain('NOT_FOUND')
    const invalid = await call(client, 'get_card', { card: 'not a key' })
    expect(invalid.isError).toBe(true)
    expect(invalid.content[0]?.text).toContain('Invalid arguments for get_card')
  })
})

describe('proposing', () => {
  it('turns keys into a proposal a person approves, and reads the decision back', async () => {
    const client = await connect(agentToken)
    const proposed = (
      await call(client, 'propose_changes', {
        space: 'PRD',
        reason: 'Prioridade da semana',
        items: [
          { kind: 'update_card', card: 'PRD-1', changes: { priority: 'high' } },
          { kind: 'create_card', card: { title: 'Minuta' } }
        ]
      })
    ).structuredContent as { proposalId: string; status: string; next: string }
    expect(proposed).toMatchObject({ status: 'pending' })
    expect(proposed.next).toContain('get_proposal')

    await ok(admin({ method: 'POST', path: `/proposals/${proposed.proposalId}/approve`, body: {} }))
    const decided = await call(client, 'get_proposal', { proposalId: proposed.proposalId })
    expect(decided.structuredContent).toMatchObject({ status: 'applied', decidedBy: { name: 'Admin' } })
    expect((await call(client, 'list_proposals', { status: 'decided' })).structuredContent).toMatchObject({
      items: [{ id: proposed.proposalId }]
    })
  })

  it('comments at once where the space allows it, and withdraws what still waits', async () => {
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/proposal-policy`, body: { autoApply: ['comment'] } }))
    const client = await connect(agentToken)
    const commented = await call(client, 'propose_changes', {
      space: 'PRD',
      reason: 'Revisão',
      items: [{ kind: 'comment', card: 'PRD-1', body: 'Revisado pelo assistente' }]
    })
    expect(commented.structuredContent).toMatchObject({ status: 'applied', autoApplied: true })

    const pending = (
      await call(client, 'propose_changes', {
        space: 'PRD',
        reason: 'Renomear',
        items: [{ kind: 'update_card', card: 'PRD-1', changes: { title: 'Contrato Acme S.A.' } }]
      })
    ).structuredContent as { proposalId: string }
    const withdrawn = await call(client, 'withdraw_proposal', { proposalId: pending.proposalId })
    expect(withdrawn.structuredContent).toMatchObject({ status: 'withdrawn' })
  })

  it('names a card the agent cannot see as not found, and proposes nothing', async () => {
    const client = await connect(agentToken)
    const refused = await call(client, 'propose_changes', {
      space: 'PRD',
      reason: 'x',
      items: [{ kind: 'comment', card: 'PRD-42', body: 'Oi' }]
    })
    expect(refused).toMatchObject({ isError: true })
    expect((await call(client, 'list_proposals')).structuredContent).toMatchObject({ items: [] })
  })
})

describe('writing as a person', () => {
  it('creates, changes, comments and links at once, within the person’s roles', async () => {
    const client = await connect(anaToken)
    const refused = await call(client, 'create_card', { space: 'PRD', title: 'Sem papel' })
    expect(refused).toMatchObject({ isError: true })
    expect(refused.content[0]?.text).toContain('FORBIDDEN')

    const ana = (
      await ok<{ items: { id: string; email: string }[] }>(admin({ method: 'GET', path: '/members' }))
    ).items.find((member) => member.email === 'ana@uselets.com')
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${ana?.id}`, body: { role: 'member' } }))
    const created = (await call(client, 'create_card', { space: 'PRD', title: 'Minuta', priority: 'high' }))
      .structuredContent as { key: string; url: string }
    expect(created).toMatchObject({ key: 'PRD-2', url: 'http://localhost:5280/espacos/PRD?card=PRD-2' })
    expect(
      (await call(client, 'update_card', { card: 'PRD-2', changes: { title: 'Minuta v2' } })).structuredContent
    ).toMatchObject({
      title: 'Minuta v2'
    })
    expect((await call(client, 'comment_on_card', { card: 'PRD-2', body: 'Pronta' })).structuredContent).toMatchObject({
      comment: { body: 'Pronta', author: { id: ana?.id } }
    })
    const linked = await call(client, 'link_cards', { card: 'PRD-2', link: { type: 'relates', key: 'PRD-1' } })
    expect(linked.structuredContent).toMatchObject({ links: [{ card: { key: 'PRD-1' } }] })
  })
})
