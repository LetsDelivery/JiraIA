import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHmac, createVerify, generateKeyPairSync, randomUUID } from 'node:crypto'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { eq } from 'drizzle-orm'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { members } from '../schema.js'

/**
 * Etapa 9 (ADR-0038): an admin installs the JiraIA GitHub App; GitHub then tells which branches and
 * pull requests name each card, their reviews and checks; a pull request merged into the default
 * branch moves its cards to the state their space chose. GitHub's API is MSW on a counterparty host.
 */
const db = await testDatabase('services/work/drizzle')
const GITHUB = 'https://api.github.counterparty.test'
const SECRET = 'webhook-secret-of-the-app'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const base = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime',
  WEB_URL: 'https://jiraia.counterparty.test'
}
const githubConfig = {
  ...base,
  GITHUB_APP_ID: '777',
  GITHUB_APP_SLUG: 'jiraia',
  GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString().replace(/\n/g, '\\n'),
  GITHUB_WEBHOOK_SECRET: SECRET,
  GITHUB_API_URL: GITHUB
}

/** Like GitHub, it answers only a JWT the App's key signed. */
const signedByApp = (authorization: string | null): boolean => {
  const [header = '', claims = '', signature = ''] = (authorization ?? '').replace('Bearer ', '').split('.')
  return createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url')
}
/** The accounts the App is installed on, as GitHub lists them. */
let installedOn = ['LetsDelivery']
const github = setupServer(
  http.get(`${GITHUB}/app/installations`, ({ request }) => {
    if (!signedByApp(request.headers.get('authorization'))) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }
    return HttpResponse.json(installedOn.map((login, index) => ({ id: 42 + index, account: { login } })))
  }),
  http.get(`${GITHUB}/app/installations/:id`, ({ request, params }) => {
    if (!signedByApp(request.headers.get('authorization'))) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }
    return params.id === '42'
      ? HttpResponse.json({ id: 42, account: { login: 'LetsDelivery' } })
      : HttpResponse.json({ message: 'Not Found' }, { status: 404 })
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

const connect = async (installationId = '42') => {
  const { url } = (await ok(admin({ method: 'POST', path: '/integrations/github/install' }))) as { url: string }
  const state = new URL(url).searchParams.get('state') ?? ''
  return await admin({ method: 'POST', path: '/integrations/github/complete', body: { installationId, state } })
}

const repository = {
  full_name: 'LetsDelivery/frete',
  html_url: 'https://github.com/LetsDelivery/frete',
  default_branch: 'master'
}

/** A delivery as GitHub signs it, from installation 42 unless said otherwise. */
const deliver = async (event: string, payload: Record<string, unknown>, delivery = randomUUID(), secret = SECRET) => {
  const body = JSON.stringify({ repository, installation: { id: 42 }, ...payload })
  return await service.githubEvents.handle({
    body,
    headers: {
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    }
  })
}

const pull = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  pull_request: {
    number: 7,
    title: 'REQ-1 Frete por região',
    html_url: 'https://github.com/LetsDelivery/frete/pull/7',
    state: 'open',
    draft: false,
    merged: false,
    merged_at: null,
    user: { login: 'ana-dev' },
    head: { ref: 'feat/REQ-1-frete', sha: 'abc123' },
    base: { ref: 'master' },
    ...extra
  }
})
const merged = (base = 'master') =>
  pull('closed', { state: 'closed', merged: true, merged_at: '2026-10-29T15:00:00Z', base: { ref: base } })

type Space = { id: string }
type State = { id: string; name: string }
let space: Space
let states: State[]
const stateNamed = (name: string) => states.find((state) => state.name === name)?.id ?? ''

const setUp = async (config: typeof base) => {
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: { now: () => new Date() }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  await ok(admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }), 201)
  await ana({ method: 'GET', path: '/me' })
  space = (await ok(
    admin({ method: 'POST', path: '/spaces', body: { key: 'REQ', name: 'Requisitos', type: 'software' } }),
    201
  )) as Space
  states = ((await ok(admin({ method: 'GET', path: `/spaces/${space.id}/workflow` }))) as { states: State[] }).states
  await ok(admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body: { title: 'Frete por região' } }), 201)
}

const card = async (key = 'REQ-1') =>
  (await ok(admin({ method: 'GET', path: `/cards/by-key/${key}` }))) as { id: string; stateId: string }
const development = async () =>
  ((await ok(ana({ method: 'GET', path: `/cards/${(await card()).id}/development` }))) as { items: unknown[] }).items

beforeAll(() => github.listen({ onUnhandledRequest: 'error' }))
afterEach(() => github.resetHandlers())
afterAll(() => github.close())
beforeEach(async () => {
  await truncateSchema(db, 'work')
  installedOn = ['LetsDelivery']
})

describe('without the GitHub App', () => {
  it('says it is not configured, connecting answers 503, and every delivery is refused', async () => {
    await setUp(base)
    expect(await ok(admin({ method: 'GET', path: '/integrations/github' }))).toEqual({
      configured: false,
      canManage: true,
      installation: null
    })
    expect(await admin({ method: 'POST', path: '/integrations/github/install' })).toMatchObject({ status: 503 })
    expect(await deliver('ping', {})).toMatchObject({ statusCode: 401 })
  })
})

describe('installing the App', () => {
  beforeEach(async () => await setUp(githubConfig))

  it('an admin installs it on GitHub and comes back; JiraIA asks GitHub, as the App, whose it is', async () => {
    const { url } = (await ok(admin({ method: 'POST', path: '/integrations/github/install' }))) as { url: string }
    expect(url).toStartWith('https://github.com/apps/jiraia/installations/new?state=')
    expect(await ok(connect())).toMatchObject({
      configured: true,
      installation: { account: 'LetsDelivery', installedBy: 'Admin' }
    })
    expect(await ok(ana({ method: 'GET', path: '/integrations/github' }))).toMatchObject({ canManage: false })
  })

  it('refuses someone who is not an admin, a forged state, and an installation that is not the App’s', async () => {
    expect(await ana({ method: 'POST', path: '/integrations/github/install' })).toMatchObject({ status: 403 })
    const forged = { installationId: '42', state: 'forged.1.x' }
    expect(await admin({ method: 'POST', path: '/integrations/github/complete', body: forged })).toMatchObject({
      status: 400
    })
    expect(await connect('9')).toMatchObject({ status: 400 })
  })

  it('an admin connects the installation an owner already made on GitHub, with no trip there', async () => {
    const connect = { method: 'POST' as const, path: '/integrations/github/connect-installed' }
    expect(await ana(connect)).toMatchObject({ status: 403 })
    expect(await ok(admin(connect))).toMatchObject({ installation: { account: 'LetsDelivery', installedBy: 'Admin' } })
    expect(await deliver('pull_request', pull('opened'))).toMatchObject({ statusCode: 200 })
    expect(await development()).toMatchObject([{ kind: 'pull_request', ref: '7' }])
  })

  it('refuses to guess when the App is installed on no account, or on more than one', async () => {
    const connect = { method: 'POST' as const, path: '/integrations/github/connect-installed' }
    installedOn = []
    expect(await admin(connect)).toMatchObject({ status: 400 })
    installedOn = ['LetsDelivery', 'stenio-lima']
    const refused = await admin(connect)
    expect(refused).toMatchObject({ status: 400 })
    expect(JSON.stringify(refused.body)).toContain('LetsDelivery, stenio-lima')
  })

  it('disconnecting forgets the installation, and its deliveries are then ignored', async () => {
    await ok(connect())
    expect(await ok(admin({ method: 'DELETE', path: '/integrations/github' }))).toMatchObject({ installation: null })
    expect(await deliver('pull_request', pull('opened'))).toMatchObject({ statusCode: 200 })
    expect(await development()).toEqual([])
  })

  it('the App uninstalled on GitHub disconnects the organization', async () => {
    await ok(connect())
    await deliver('installation', { action: 'deleted' })
    expect(await ok(admin({ method: 'GET', path: '/integrations/github' }))).toMatchObject({ installation: null })
  })
})

describe('what GitHub tells', () => {
  beforeEach(async () => {
    await setUp(githubConfig)
    await ok(connect())
  })

  it('refuses a delivery not signed with the App’s secret', async () => {
    expect(await deliver('ping', {}, randomUUID(), 'another-secret-of-16')).toMatchObject({ statusCode: 401 })
  })

  it('links a branch named after the card, and marks it deleted when it goes', async () => {
    await deliver('create', { ref: 'feat/req-1-frete', ref_type: 'branch', sender: { login: 'ana-dev' } })
    expect(await development()).toMatchObject([
      {
        kind: 'branch',
        repo: 'LetsDelivery/frete',
        ref: 'feat/req-1-frete',
        state: 'active',
        url: 'https://github.com/LetsDelivery/frete/tree/feat/req-1-frete'
      }
    ])
    await deliver('delete', { ref: 'feat/req-1-frete', ref_type: 'branch', sender: { login: 'ana-dev' } })
    expect(await development()).toMatchObject([{ kind: 'branch', state: 'deleted' }])
  })

  it('follows a pull request through its review and checks; a delivery sent again changes nothing', async () => {
    await deliver('pull_request', pull('opened'))
    await deliver('pull_request_review', {
      action: 'submitted',
      review: { state: 'approved' },
      pull_request: { number: 7 }
    })
    const delivery = randomUUID()
    await deliver(
      'check_suite',
      { action: 'completed', check_suite: { head_sha: 'abc123', conclusion: 'failure' } },
      delivery
    )
    expect(await development()).toMatchObject([
      {
        kind: 'pull_request',
        ref: '7',
        title: 'REQ-1 Frete por região',
        state: 'open',
        review: 'approved',
        checks: 'failure',
        author: 'ana-dev'
      }
    ])

    await deliver('check_suite', { action: 'requested', check_suite: { head_sha: 'abc123' } }, delivery)
    expect(await development()).toMatchObject([{ checks: 'failure' }])
  })

  it('ignores a key no card has and a branch without one', async () => {
    await deliver('create', { ref: 'feat/XYZ-9-nada', ref_type: 'branch', sender: { login: 'ana-dev' } })
    await deliver('create', { ref: 'master-hotfix', ref_type: 'branch', sender: { login: 'ana-dev' } })
    expect(await development()).toEqual([])
  })
})

describe('a merged pull request', () => {
  beforeEach(async () => {
    await setUp(githubConfig)
    await ok(connect())
    await deliver('pull_request', pull('opened'))
  })

  it('moves its card to the state the space chose, as GitHub', async () => {
    await ok(admin({ method: 'PATCH', path: `/spaces/${space.id}`, body: { mergedStateId: stateNamed('Em revisão') } }))
    await deliver('pull_request', merged())
    expect((await card()).stateId).toBe(stateNamed('Em revisão'))
    expect(await development()).toMatchObject([{ state: 'merged', mergedAt: '2026-10-29T15:00:00.000Z' }])
    const history = (await ok(admin({ method: 'GET', path: `/cards/${(await card()).id}/history` }))) as {
      items: { action: string; actorId: string }[]
    }
    const move = history.items.at(-1)
    const [actor] = await db
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, move?.actorId ?? ''))
    expect({ action: move?.action, actor: actor?.name }).toEqual({ action: 'moved', actor: 'GitHub' })
  })

  it('leaves the card where it is when the space chose no state', async () => {
    const before = (await card()).stateId
    await deliver('pull_request', merged())
    expect((await card()).stateId).toBe(before)
  })

  it('does not move it for a merge into another branch, nor out of a done state', async () => {
    await ok(admin({ method: 'PATCH', path: `/spaces/${space.id}`, body: { mergedStateId: stateNamed('Em revisão') } }))
    const before = (await card()).stateId
    await deliver('pull_request', merged('release'))
    expect((await card()).stateId).toBe(before)

    await ok(
      admin({
        method: 'POST',
        path: `/cards/${(await card()).id}/move`,
        body: { stateId: stateNamed('Concluído'), index: 0 }
      })
    )
    await deliver('pull_request', merged())
    expect((await card()).stateId).toBe(stateNamed('Concluído'))
  })

  it('refuses a state of another space as the space’s choice', async () => {
    const other = (await ok(
      admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Tecnologia', type: 'software' } }),
      201
    )) as Space
    const theirs = ((await ok(admin({ method: 'GET', path: `/spaces/${other.id}/workflow` }))) as { states: State[] })
      .states[0]?.id
    expect(
      await admin({ method: 'PATCH', path: `/spaces/${space.id}`, body: { mergedStateId: theirs } })
    ).toMatchObject({
      status: 404
    })
  })
})
