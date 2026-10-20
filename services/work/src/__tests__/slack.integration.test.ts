import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { slackWorkspaces } from '../schema-intake.js'

/**
 * Etapa 5e (ADR-0018): an admin connects the organization's Slack workspace through Slack's OAuth;
 * notices a person routes to Slack arrive as direct messages; a JiraIA link or a card key written in
 * Slack gets the card's preview. Slack's Web API is MSW on a counterparty host.
 */
const db = await testDatabase('services/work/drizzle')
const SLACK = 'https://slack.counterparty.test/api'
const SIGNING = 'signing-secret'
const base = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime',
  WEB_URL: 'https://jiraia.counterparty.test'
}
const slackConfig = {
  ...base,
  SLACK_CLIENT_ID: 'client-1',
  SLACK_CLIENT_SECRET: 'client-secret',
  SLACK_SIGNING_SECRET: SIGNING,
  SLACK_TOKEN_KEY: Buffer.alloc(32, 3).toString('base64'),
  SLACK_API_URL: SLACK
}

type Sent = { method: string; body: Record<string, unknown>; auth: string | null }
let sent: Sent[] = []
const slack = setupServer(
  http.post(`${SLACK}/oauth.v2.access`, async ({ request }) => {
    const form = new URLSearchParams(await request.text())
    sent.push({ method: 'oauth.v2.access', body: Object.fromEntries(form), auth: null })
    return form.get('code') === 'good'
      ? HttpResponse.json({
          ok: true,
          access_token: 'xoxb-secret',
          bot_user_id: 'UBOT',
          team: { id: 'T1', name: 'Let’s' }
        })
      : HttpResponse.json({ ok: false, error: 'invalid_code' })
  }),
  http.post(`${SLACK}/:method`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>
    sent.push({ method: String(params.method), body, auth: request.headers.get('authorization') })
    if (params.method === 'users.lookupByEmail') {
      return body.email === 'nobody@uselets.com'
        ? HttpResponse.json({ ok: false, error: 'users_not_found' })
        : HttpResponse.json({ ok: true, user: { id: `U-${String(body.email).split('@')[0]}` } })
    }
    return HttpResponse.json({ ok: true })
  })
)

let service: ReturnType<typeof buildService>
const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as Record<string, unknown>
}

/** The state Slack hands back is the one the install URL carried. */
const connect = async () => {
  const { url } = (await ok(admin({ method: 'POST', path: '/integrations/slack/install' }))) as { url: string }
  const state = new URL(url).searchParams.get('state') ?? ''
  return await ok(admin({ method: 'POST', path: '/integrations/slack/complete', body: { code: 'good', state } }))
}

/** A request as Slack signs it. */
const fromSlack = (payload: unknown, at = Math.floor(Date.now() / 1000), headers: Record<string, string> = {}) => {
  const body = JSON.stringify(payload)
  const signature = `v0=${createHmac('sha256', SIGNING).update(`v0:${at}:${body}`).digest('hex')}`
  return { body, headers: { 'x-slack-request-timestamp': String(at), 'x-slack-signature': signature, ...headers } }
}

const setUp = async (config: typeof base) => {
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: { now: () => new Date() }, ids: uuidGenerator },
    { organizationName: "Let's", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  await ok(admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }), 201)
  await ana({ method: 'GET', path: '/me' })
}

beforeAll(() => slack.listen({ onUnhandledRequest: 'error' }))
afterEach(() => slack.resetHandlers())
afterAll(() => slack.close())
beforeEach(async () => {
  await truncateSchema(db, 'work')
  sent = []
})

describe('without the Slack app', () => {
  it('says it is not configured, and connecting answers 503', async () => {
    await setUp(base)
    expect(await ok(admin({ method: 'GET', path: '/integrations/slack' }))).toEqual({
      configured: false,
      canManage: true,
      workspace: null,
      me: null
    })
    expect(await admin({ method: 'POST', path: '/integrations/slack/install' })).toMatchObject({ status: 503 })
  })
})

describe('connecting the workspace', () => {
  beforeEach(async () => await setUp(slackConfig))

  it('an admin connects through Slack’s consent screen; the token is kept sealed', async () => {
    const { url } = (await ok(admin({ method: 'POST', path: '/integrations/slack/install' }))) as { url: string }
    expect(url).toStartWith('https://slack.com/oauth/v2/authorize?')
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://jiraia.counterparty.test/slack/conectar')

    const status = await connect()
    expect(status).toMatchObject({
      configured: true,
      workspace: { teamName: 'Let’s', installedBy: 'Admin' },
      me: { found: true }
    })
    const stored = await db.select({ token: slackWorkspaces.botToken }).from(slackWorkspaces)
    expect(stored[0]?.token).not.toContain('xoxb-secret')
  })

  it('refuses someone who is not an admin, and a state that was not issued to the caller', async () => {
    expect(await ana({ method: 'POST', path: '/integrations/slack/install' })).toMatchObject({ status: 403 })
    const refused = await admin({
      method: 'POST',
      path: '/integrations/slack/complete',
      body: { code: 'good', state: 'forged.1.x' }
    })
    expect(refused).toMatchObject({ status: 400 })
  })

  it('finds each person by e-mail, and disconnecting forgets the workspace', async () => {
    await connect()
    expect(await ok(ana({ method: 'GET', path: '/integrations/slack' }))).toMatchObject({
      canManage: false,
      me: { found: true }
    })
    expect(sent.find((each) => each.method === 'users.lookupByEmail')?.auth).toBe('Bearer xoxb-secret')
    expect(await ok(admin({ method: 'DELETE', path: '/integrations/slack' }))).toMatchObject({ workspace: null })
  })
})

describe('notices in Slack', () => {
  beforeEach(async () => await setUp(slackConfig))

  it('sends a notice as a direct message to who routed that kind to Slack, and to nobody else', async () => {
    await connect()
    const space = await ok(
      admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery', type: 'business' } }),
      201
    )
    const anaId = ((await ok(ana({ method: 'GET', path: '/me' }))) as { id: string }).id
    await ok(admin({ method: 'PUT', path: `/spaces/${space.id}/members/${anaId}`, body: { role: 'member' } }))
    await ok(ana({ method: 'PUT', path: '/me/notification-preferences', body: { kind: 'assigned', channel: 'slack' } }))

    await ok(
      admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body: { title: 'Rastreio', assigneeId: anaId } }),
      201
    )
    await service.drain()

    const messages = sent.filter((each) => each.method === 'chat.postMessage')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.body).toMatchObject({ channel: 'U-ana', text: 'Admin atribuiu PRD-1 a você' })
    expect(JSON.stringify(messages[0]?.body.blocks)).toContain(
      'https://jiraia.counterparty.test/espacos/PRD?card=PRD-1'
    )
  })
})

describe('what Slack sends', () => {
  beforeEach(async () => {
    await setUp(slackConfig)
    await connect()
    const space = await ok(
      admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery', type: 'business' } }),
      201
    )
    await ok(admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body: { title: 'Rastreio <script>' } }), 201)
    sent = []
  })

  it('answers Slack’s URL check, and refuses a request with a wrong or old signature', async () => {
    expect(await service.slackEvents.handle(fromSlack({ type: 'url_verification', challenge: 'abc' }))).toEqual({
      statusCode: 200,
      body: '{"challenge":"abc"}'
    })
    const forged = {
      ...fromSlack({ type: 'url_verification', challenge: 'abc' }),
      body: '{"type":"url_verification","challenge":"x"}'
    }
    expect((await service.slackEvents.handle(forged)).statusCode).toBe(401)
    expect((await service.slackEvents.handle(fromSlack({ type: 'url_verification' }, 1_000))).statusCode).toBe(401)
  })

  it('previews a shared JiraIA link to a card, escaping what people wrote', async () => {
    const url = 'https://jiraia.counterparty.test/espacos/PRD?card=PRD-1'
    const event = {
      type: 'link_shared',
      channel: 'C1',
      message_ts: '1.1',
      ts: '1.1',
      links: [{ url }, { url: 'https://elsewhere.test/?card=PRD-1' }]
    }
    await service.slackEvents.handle(fromSlack({ type: 'event_callback', team_id: 'T1', event }))
    const [unfurl] = sent.filter((each) => each.method === 'chat.unfurl')
    expect(Object.keys(unfurl?.body.unfurls as object)).toEqual([url])
    expect(JSON.stringify(unfurl?.body)).toContain('Rastreio &lt;script&gt;')
  })

  it('answers a card key in a message with its preview in the thread, once, and never a bot', async () => {
    const message = { type: 'message', channel: 'C1', ts: '2.2', text: 'olhem prd-1 e PRD-999' }
    await service.slackEvents.handle(fromSlack({ type: 'event_callback', team_id: 'T1', event: message }))
    await service.slackEvents.handle(
      fromSlack({ type: 'event_callback', team_id: 'T1', event: message }, undefined, { 'x-slack-retry-num': '1' })
    )
    await service.slackEvents.handle(
      fromSlack({ type: 'event_callback', team_id: 'T1', event: { ...message, bot_id: 'B1' } })
    )
    const replies = sent.filter((each) => each.method === 'chat.postMessage')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.body).toMatchObject({ channel: 'C1', thread_ts: '2.2' })
    expect(JSON.stringify(replies[0]?.body.blocks)).toContain('PRD-1')
  })
})
