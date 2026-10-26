import { beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { runWakes } from '../lambda/jobs.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { InMemoryMailer, UnavailableMailer } from '../notifications/mailer.js'
import { HeldWakes } from '../wake/waker.js'

/**
 * ADR-0035: the database is woken only by work. Each job's next wake is read from what is pending —
 * the outbox, the notices to mail, the LET’S Draw AI morning — and nothing is planned once it is done,
 * so an idle organization never wakes it.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime',
  WEB_URL: 'https://jiraia.test'
}
const MINUTE = 60_000
const logger = createLogger('test', 'wake')

let service: ReturnType<typeof buildService>
let wakes: HeldWakes
let now: Date
let spaceId: string
const people: Record<string, string> = {}

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const build = (overrides: Parameters<typeof buildService>[1] = {}) =>
  buildService(config, { db, mailer: new InMemoryMailer(), wakes, clock: { now: () => now }, ...overrides })

/** Everything pending done: the outbox drained, the mail due sent. */
const settle = async () => {
  await service.drain()
  await service.mail.sendDue()
}

const newCard = async (title: string) =>
  (await ok(admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title } }), 201)) as { id: string }

beforeEach(async () => {
  await truncateSchema(db, 'work')
  now = new Date('2026-10-19T12:00:00Z')
  wakes = new HeldWakes()
  service = build()
  await bootstrapOrganization(
    { db, clock: { now: () => now }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (await ok(
    admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery', type: 'business' } }),
    201
  )) as { id: string }
  spaceId = space.id
  for (const [email, name] of [
    ['ana@uselets.com', 'Ana Lima'],
    ['gil@uselets.com', 'Gil Souza']
  ] as const) {
    const member = (await ok(admin({ method: 'POST', path: '/members', body: { email, name } }), 201)) as { id: string }
    people[email] = member.id
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role: 'member' } }))
  }
  await settle()
  service.commits.take()
})

describe('the plan', () => {
  it('is empty once the work is done: an idle organization wakes nothing', async () => {
    expect(await service.planner.plan()).toEqual(new Map())
  })

  it('wakes the dispatch at once while a commit waits in the outbox, and not after', async () => {
    await newCard('Rastreio')
    expect(service.commits.take()).toBe(true)
    expect((await service.planner.plan()).get('dispatch')).toEqual(now)
    await service.drain()
    expect((await service.planner.plan()).has('dispatch')).toBe(false)
  })

  it('wakes the mail at once for a mention, and at the end of the window for a card’s changes', async () => {
    const card = await newCard('Rastreio')
    await settle()
    await ok(ana({ method: 'POST', path: `/cards/${card.id}/comments`, body: { body: 'Acompanhando' } }), 201)
    await service.drain()
    expect((await service.planner.plan()).get('mail')).toEqual(new Date(now.getTime() + 10 * MINUTE))

    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> vê?` }
      }),
      201
    )
    await service.drain()
    expect((await service.planner.plan()).get('mail')).toEqual(now)
  })

  it('plans no mail while there is no sender, however much waits', async () => {
    const card = await newCard('Rastreio')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> vê?` }
      }),
      201
    )
    await service.drain()
    service = build({ mailer: new UnavailableMailer() })
    expect(await service.planner.plan()).toEqual(new Map())
  })

  it('wakes the morning job at the next 08:00 in São Paulo for a LET’S Draw AI notice', async () => {
    const draw = (await ok(admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } }), 201)) as {
      id: string
    }
    const page = (await ok(
      admin({ method: 'POST', path: `/draw/spaces/${draw.id}/contents`, body: { title: 'SLAs' } }),
      201
    )) as { id: string }
    await ok(
      admin({
        method: 'POST',
        path: `/draw/contents/${page.id}/comments`,
        body: { body: `<@${people['ana@uselets.com']}> confere?` }
      }),
      201
    )
    await service.drain()
    expect((await service.planner.plan()).get('morning')).toEqual(new Date('2026-10-20T11:00:00Z'))
    await service.mail.morning()
    expect((await service.planner.plan()).has('morning')).toBe(false)
  })
})

describe('a pass of the jobs', () => {
  it('runs what woke it, then wakes each job for what is left: the mention now, the card’s comment later', async () => {
    const card = await newCard('Rastreio')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> vê?` }
      }),
      201
    )
    await runWakes(service, logger, [{ job: 'dispatch', retry: 0 }])
    expect(wakes.held).toEqual([{ job: 'mail', at: now, retry: 0 }])

    // The mention went; Admin, who follows the card, hears of the comment when its window closes.
    wakes.held.length = 0
    await runWakes(service, logger, [{ job: 'mail', retry: 0 }])
    expect(wakes.held).toEqual([{ job: 'mail', at: new Date(now.getTime() + 10 * MINUTE), retry: 0 }])

    wakes.held.length = 0
    now = new Date(now.getTime() + 10 * MINUTE)
    await runWakes(service, logger, [{ job: 'mail', retry: 0 }])
    expect(wakes.held).toEqual([])
  })
})
