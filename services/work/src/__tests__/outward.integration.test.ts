import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'

import { uuidGenerator } from '@jiraia/core'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { sql } from 'drizzle-orm'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Etapa 5c (escopo-mvp 4.7, 4.8): API tokens on `/v1` — personal and of a service account — and
 * outgoing webhooks, signed, retried on a schedule, delivered once per event. The receiver is MSW on
 * a counterparty host; the clock is the suite's, so retries can be walked through.
 */
const db = await testDatabase('services/work/drizzle')
const HOOK = 'https://erp.counterparty.test/jiraia'
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Received = { body: string; headers: Record<string, string> }
let received: Received[] = []
let answers: number[] = []
const receiver = setupServer(
  http.post(HOOK, async ({ request }) => {
    received.push({ body: await request.text(), headers: Object.fromEntries(request.headers.entries()) })
    return new HttpResponse('ok', { status: answers.shift() ?? 200 })
  })
)

let now = new Date('2026-10-17T12:00:00Z')
const clock = { now: () => new Date(now) }
const advance = (minutes: number) => {
  now = new Date(now.getTime() + minutes * 60_000)
}

let service: ReturnType<typeof buildService>
let spaceId: string
let otherSpaceId: string
let states: { id: string }[]

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')

/** A request on `/v1`, with or without a token — no Google claims, as API Gateway sends it there. */
const withToken = async (token: string | undefined, input: Omit<Call, 'subject' | 'claims'>) => {
  const event = apiEvent({ ...input, path: `/v1${input.path}` })
  return answer(
    await service.router({
      ...event,
      headers: { ...event.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }
    })
  )
}

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const space = async (key: string) =>
  (
    (await ok(admin({ method: 'POST', path: '/spaces', body: { key, name: key, type: 'business' } }), 201)) as {
      id: string
    }
  ).id

beforeAll(() => receiver.listen({ onUnhandledRequest: 'error' }))
afterAll(() => receiver.close())

beforeEach(async () => {
  await truncateSchema(db, 'work')
  received = []
  answers = []
  now = new Date('2026-10-17T12:00:00Z')
  service = buildService(config, {
    db,
    clock,
    webhookHttp: createHttpClient({ provider: 'webhook', logger: createLogger('test', 'webhooks') })
  })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  spaceId = await space('PRD')
  otherSpaceId = await space('REQ')
  states = ((await ok(admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` }))) as { states: typeof states })
    .states
  const member = (await ok(
    admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }),
    201
  )) as { id: string }
  await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role: 'member' } }))
})

describe('personal API tokens', () => {
  const issue = async (body: Record<string, unknown> = { name: 'Roadmap' }) =>
    (await ok(ana({ method: 'POST', path: '/me/tokens', body }), 201)) as {
      token: { id: string; hint: string }
      value: string
    }

  it('act as their person on /v1, show their value once, and stop when revoked', async () => {
    const { token, value } = await issue()

    expect(value.startsWith(token.hint)).toBe(true)
    expect(JSON.stringify(await ok(ana({ method: 'GET', path: '/me/tokens' })))).not.toContain(value)
    expect(await withToken(value, { method: 'GET', path: '/me' })).toMatchObject({
      status: 200,
      body: { email: 'ana@uselets.com' }
    })

    await ok(ana({ method: 'DELETE', path: `/api-tokens/${token.id}` }))
    expect((await withToken(value, { method: 'GET', path: '/me' })).status).toBe(401)
  })

  it('stop working when they expire, and refuse a missing or made-up token', async () => {
    const { value } = await issue({ name: 'Uma semana', expiresInDays: 7 })
    advance(7 * 24 * 60 + 1)

    expect((await withToken(value, { method: 'GET', path: '/me' })).status).toBe(401)
    expect((await withToken(undefined, { method: 'GET', path: '/me' })).status).toBe(401)
    expect((await withToken(`jia_${'x'.repeat(43)}`, { method: 'GET', path: '/me' })).status).toBe(401)
  })

  it('cannot mint another token', async () => {
    const { value } = await issue()
    expect((await withToken(value, { method: 'POST', path: '/me/tokens', body: { name: 'Outro' } })).status).toBe(403)
  })
})

describe('service accounts', () => {
  it('write only where they were given a role, and show in history under their name', async () => {
    const account = (await ok(
      admin({ method: 'POST', path: '/service-accounts', body: { name: 'Rotina de roadmap' } }),
      201
    )) as { id: string }
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${account.id}`, body: { role: 'member' } }))
    const { value } = (await ok(
      admin({ method: 'POST', path: `/service-accounts/${account.id}/tokens`, body: { name: 'MCP' } }),
      201
    )) as { value: string }

    const card = (
      await withToken(value, {
        method: 'POST',
        path: `/spaces/${spaceId}/cards`,
        body: { title: 'Criado pela rotina' }
      })
    ).body as { id: string }
    expect(
      (await withToken(value, { method: 'POST', path: `/spaces/${otherSpaceId}/cards`, body: { title: 'x' } })).status
    ).toBe(403)

    const history = (await ok(admin({ method: 'GET', path: `/cards/${card.id}/history` }))) as {
      items: { actorId: string }[]
    }
    expect(history.items[0]?.actorId).toBe(account.id)
  })

  it('have no profile of their own to edit', async () => {
    const account = (await ok(
      admin({ method: 'POST', path: '/service-accounts', body: { name: 'Rotina de roadmap' } }),
      201
    )) as { id: string }
    const { value } = (await ok(
      admin({ method: 'POST', path: `/service-accounts/${account.id}/tokens`, body: { name: 'MCP' } }),
      201
    )) as { value: string }

    const renamed = await withToken(value, { method: 'PATCH', path: '/me', body: { name: 'Outro nome' } })

    expect(renamed.status).toBe(403)
  })

  it('are made by organization admins only', async () => {
    expect((await ana({ method: 'POST', path: '/service-accounts', body: { name: 'x' } })).status).toBe(403)
  })
})

describe('outgoing webhooks', () => {
  const create = async () =>
    (await ok(
      admin({
        method: 'POST',
        path: `/spaces/${spaceId}/webhooks`,
        body: { name: 'ERP', url: HOOK, events: ['card.moved'] }
      }),
      201
    )) as {
      webhook: { id: string }
      secret: string
    }

  const moveCard = async () => {
    const card = (await ok(
      admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title: 'Fatura' } }),
      201
    )) as { id: string }
    await ok(admin({ method: 'POST', path: `/cards/${card.id}/move`, body: { stateId: states[1]?.id, index: 0 } }))
    await service.drain()
  }

  const deliveries = async (webhookId: string) =>
    (
      (await ok(admin({ method: 'GET', path: `/webhooks/${webhookId}/deliveries` }))) as {
        items: { status: string; attempts: number }[]
      }
    ).items

  it('posts the event signed with the secret only its admins saw once', async () => {
    const { webhook, secret } = await create()
    await moveCard()

    expect(received).toHaveLength(1)
    const [sent] = received as [Received]
    const [t, v1] = (sent.headers['x-jiraia-signature'] ?? '').split(',').map((part) => part.split('=')[1])
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${sent.body}`).digest('hex'))
    expect(sent.headers['x-jiraia-event']).toBe('card.moved')
    expect(JSON.parse(sent.body)).toMatchObject({
      type: 'card.moved',
      card: { title: 'Fatura' },
      actor: { name: 'Admin' }
    })
    expect(await deliveries(webhook.id)).toEqual([expect.objectContaining({ status: 'delivered', attempts: 1 })])
    expect(JSON.stringify(await ok(admin({ method: 'GET', path: `/spaces/${spaceId}/webhooks` })))).not.toContain(
      secret
    )
  })

  it('tries again on the schedule until the receiver answers, and gives up after five retries', async () => {
    const { webhook } = await create()
    answers = [500, 503]
    await moveCard()
    expect(await deliveries(webhook.id)).toEqual([expect.objectContaining({ status: 'pending', attempts: 1 })])

    expect(await service.webhookSender.retryDue()).toBe(0)
    advance(1)
    await service.webhookSender.retryDue()
    advance(5)
    await service.webhookSender.retryDue()
    expect(await deliveries(webhook.id)).toEqual([expect.objectContaining({ status: 'delivered', attempts: 3 })])

    answers = [500, 500, 500, 500, 500, 500]
    await moveCard()
    for (const wait of [1, 5, 30, 120, 360]) {
      advance(wait)
      await service.webhookSender.retryDue()
    }
    expect((await deliveries(webhook.id))[0]).toMatchObject({ status: 'failed', attempts: 6 })
  })

  it('delivers an event once, however often the bus repeats it', async () => {
    await create()
    await moveCard()
    await db.execute(sql`UPDATE work.audit_events SET dispatched_at = NULL`)
    await db.execute(sql`DELETE FROM work.event_receipts`)
    await service.drain()

    expect(received).toHaveLength(1)
  })

  it('refuses an address inside a network, and keeps webhooks to the space admins', async () => {
    const internal = await admin({
      method: 'POST',
      path: `/spaces/${spaceId}/webhooks`,
      body: { name: 'x', url: 'https://169.254.169.254/latest', events: ['card.moved'] }
    })
    expect(internal.status).toBe(400)
    expect((await ana({ method: 'GET', path: `/spaces/${spaceId}/webhooks` })).status).toBe(403)
  })

  it('signs with the new secret once it is rotated', async () => {
    const { webhook, secret } = await create()
    const rotated = (await ok(admin({ method: 'POST', path: `/webhooks/${webhook.id}/secret` }))) as { secret: string }
    await moveCard()

    const [sent] = received as [Received]
    const [t, v1] = (sent.headers['x-jiraia-signature'] ?? '').split(',').map((part) => part.split('=')[1])
    expect(rotated.secret).not.toBe(secret)
    expect(v1).toBe(createHmac('sha256', rotated.secret).update(`${t}.${sent.body}`).digest('hex'))
  })

  it('posts a sprint started and closed, with what it committed and completed (ADR-0029)', async () => {
    const sprintSpace = (await ok(
      admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery', type: 'software' } }),
      201
    )) as { id: string }
    await ok(
      admin({
        method: 'POST',
        path: `/spaces/${sprintSpace.id}/webhooks`,
        body: { name: 'Painel', url: HOOK, events: ['sprint.started', 'sprint.closed'] }
      }),
      201
    )
    const sprint = (await ok(admin({ method: 'POST', path: `/spaces/${sprintSpace.id}/sprints`, body: {} }), 201)) as {
      id: string
    }
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/close`, body: { openCardsTo: 'backlog' } }))
    await service.drain()

    expect(received.map((each) => JSON.parse(each.body).type)).toEqual(['sprint.started', 'sprint.closed'])
    expect(JSON.parse((received[1] as Received).body)).toMatchObject({
      sprint: { name: 'Sprint 1', state: 'closed', committed: { cards: 0 }, completed: { cards: 0 } }
    })
  })
})
