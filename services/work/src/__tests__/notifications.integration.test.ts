import { beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { InMemoryMailer } from '../notifications/mailer.js'

/**
 * Etapa 5b (escopo-mvp 4.6): who gets a notice for what, the inbox and its boxes, the preferences,
 * and the daily summary — through the API, with `drain()` standing in for the bus.
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

type Notice = { id: string; kind: string; actor: { name: string }; data: Record<string, string>; readAt: string | null }
type Inbox = { items: Notice[]; unread: number }

let service: ReturnType<typeof buildService>
let mailer: InMemoryMailer
let spaceId: string
let states: { id: string; name: string }[]
const people: Record<string, string> = {}

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')
const gil = as('gil@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const invite = async (email: string, name: string, role?: string) => {
  const member = (await ok(admin({ method: 'POST', path: '/members', body: { email, name } }), 201)) as { id: string }
  people[email] = member.id
  if (role) {
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role } }))
  }
  await as(email)({ method: 'GET', path: '/me' })
}

const inbox = async (who: ReturnType<typeof as>, box = 'inbox') =>
  (await ok(who({ method: 'GET', path: '/me/notifications', query: { box } }))) as Inbox

const newCard = async (title: string, by = admin) =>
  (await ok(by({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title } }), 201)) as {
    id: string
    key: string
  }

beforeEach(async () => {
  await truncateSchema(db, 'work')
  mailer = new InMemoryMailer()
  service = buildService(config, { db, mailer })
  await bootstrapOrganization(
    { db, clock: { now: () => new Date('2026-10-17T12:00:00Z') }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (await ok(
    admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery', type: 'business' } }),
    201
  )) as {
    id: string
  }
  spaceId = space.id
  states = ((await ok(admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` }))) as { states: typeof states })
    .states
  await invite('ana@uselets.com', 'Ana', 'member')
  await invite('gil@uselets.com', 'Gil', 'member')
})

describe('who gets a notice', () => {
  it('tells whoever is mentioned, and the card followers that someone commented — never the author', async () => {
    const card = await newCard('Rastreio em tempo real')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> consegue revisar?` }
      }),
      201
    )
    await service.drain()

    expect((await inbox(gil)).items).toEqual([
      expect.objectContaining({
        kind: 'mentioned',
        actor: expect.objectContaining({ name: 'Ana' }),
        data: expect.objectContaining({ cardKey: card.key, excerpt: '@Gil consegue revisar?' })
      })
    ])
    expect((await inbox(admin)).items.map((notice) => notice.kind)).toEqual(['commented'])
    expect((await inbox(ana)).items).toEqual([])
  })

  it('tells a person who is given a card, and the followers where the card went', async () => {
    const card = await newCard('Painel de SLA')
    await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { assigneeId: people['ana@uselets.com'] } }))
    const target = states[1] as { id: string; name: string }
    await ok(gil({ method: 'POST', path: `/cards/${card.id}/move`, body: { stateId: target.id, index: 0 } }))
    await service.drain()

    expect((await inbox(ana)).items.map((notice) => [notice.kind, notice.data.stateName ?? ''])).toEqual([
      ['state_changed', target.name],
      ['assigned', '']
    ])
    expect((await inbox(admin)).items.map((notice) => notice.kind)).toEqual(['state_changed'])
  })

  it('tells the space admins someone asked to edit, and that person how it was decided', async () => {
    await invite('rui@uselets.com', 'Rui')
    await ok(
      admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${people['gil@uselets.com']}`, body: { role: 'admin' } })
    )
    const request = (await ok(
      as('rui@uselets.com')({
        method: 'POST',
        path: '/access-requests',
        body: { product: 'jiraia', spaceId, message: 'Sou de CS' }
      }),
      201
    )) as { id: string }
    await service.drain()
    expect((await inbox(gil)).items).toEqual([
      expect.objectContaining({ kind: 'access_requested', data: expect.objectContaining({ spaceName: 'Discovery' }) })
    ])

    await ok(gil({ method: 'POST', path: `/access-requests/${request.id}/decision`, body: { approve: true } }))
    await service.drain()
    expect((await inbox(as('rui@uselets.com'))).items).toEqual([
      expect.objectContaining({ kind: 'access_decided', data: expect.objectContaining({ status: 'approved' }) })
    ])
  })

  it('leaves nothing for a kind the person turned off', async () => {
    await ok(gil({ method: 'PUT', path: '/me/notification-preferences', body: { kind: 'mentioned', channel: 'none' } }))
    const card = await newCard('Cotação')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> olha` }
      }),
      201
    )
    await service.drain()

    expect((await inbox(gil)).items).toEqual([])
  })
})

describe('the inbox', () => {
  const mentionGil = async () => {
    const card = await newCard('Mapa de calor')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> veja` }
      }),
      201
    )
    await service.drain()
    return ((await inbox(gil)).items[0] as Notice).id
  }

  it('reads, snoozes and archives, and counts only what is unread in the inbox', async () => {
    const id = await mentionGil()
    expect((await inbox(gil)).unread).toBe(1)

    await ok(
      gil({ method: 'PATCH', path: `/me/notifications/${id}`, body: { snoozedUntil: '2099-01-01T11:00:00.000Z' } })
    )
    expect(await inbox(gil)).toMatchObject({ items: [], unread: 0 })
    expect((await inbox(gil, 'snoozed')).items).toHaveLength(1)

    await ok(gil({ method: 'PATCH', path: `/me/notifications/${id}`, body: { snoozedUntil: null, archived: true } }))
    expect((await inbox(gil, 'archived')).items).toHaveLength(1)
    expect((await inbox(gil)).items).toEqual([])
  })

  it('keeps each inbox its owner’s', async () => {
    const id = await mentionGil()
    expect((await ana({ method: 'PATCH', path: `/me/notifications/${id}`, body: { read: true } })).status).toBe(404)
  })
})

describe('the daily summary', () => {
  it('mails each person what they chose by e-mail and have not read, once', async () => {
    const card = await newCard('Rastreio')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> revisa` }
      }),
      201
    )
    await service.drain()

    expect(await service.digest.run()).toEqual({ sent: 1, failed: 0 })
    expect(mailer.sent).toEqual([
      expect.objectContaining({
        to: 'gil@uselets.com',
        subject: 'JiraIA: 1 novidade para você',
        text: expect.stringContaining(`Ana mencionou você em ${card.key}`)
      })
    ])
    expect(mailer.sent[0]?.html).toContain(`https://jiraia.test/espacos/PRD?card=${card.key}`)
    expect(await service.digest.run()).toEqual({ sent: 0, failed: 0 })
  })

  it('does not mail what was read first, nor what the person keeps to the panel', async () => {
    await ok(
      gil({ method: 'PUT', path: '/me/notification-preferences', body: { kind: 'commented', channel: 'in_app' } })
    )
    const card = await newCard('Cotação')
    await ok(
      ana({
        method: 'POST',
        path: `/cards/${card.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> revisa` }
      }),
      201
    )
    await service.drain()
    await ok(gil({ method: 'POST', path: '/me/notifications/read-all' }))

    expect(await service.digest.run()).toEqual({ sent: 0, failed: 0 })
    expect(mailer.sent).toEqual([])
  })
})
