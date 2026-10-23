import { beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { InMemoryMailer } from '../notifications/mailer.js'

/**
 * Etapa 3b (escopo-mvp 3.11, ADR-0029): a space's sprints — planned, started, closed with their open
 * cards carried — through the API, with a clock the suite moves.
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

type Sprint = {
  id: string
  number: number
  name: string
  state: string
  startsOn: string
  endsOn: string
  committed: { cards: number; points: number } | null
  completed: { cards: number; points: number } | null
  carried: { cards: number; points: number } | null
}
type Card = { id: string; key: string; sprintId: string | null; points: number | null }
type State = { id: string; name: string; group: string }

let service: ReturnType<typeof buildService>
let mailer: InMemoryMailer
let now: Date
let spaceId: string
let states: State[]

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')

const ok = async <T>(call: Promise<{ status: number; body: unknown }>, status = 200): Promise<T> => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as T
}

const newSprint = async (body: Record<string, unknown> = {}) =>
  await ok<Sprint>(admin({ method: 'POST', path: `/spaces/${spaceId}/sprints`, body }), 201)

const newCard = async (title: string, points?: number) => {
  const card = await ok<Card>(admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title } }), 201)
  return points === undefined
    ? card
    : await ok<Card>(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { points } }))
}

const plan = async (cardId: string, sprintId: string | null) =>
  await ok<Card>(admin({ method: 'PATCH', path: `/cards/${cardId}`, body: { sprintId } }))

const stateIn = (group: string) => states.find((state) => state.group === group) as State

beforeEach(async () => {
  await truncateSchema(db, 'work')
  now = new Date('2026-10-23T15:00:00Z')
  mailer = new InMemoryMailer()
  service = buildService(config, { db, mailer, clock: { now: () => now } })
  await bootstrapOrganization(
    { db, clock: { now: () => now }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = await ok<{ id: string; usesSprints: boolean }>(
    admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery Board', type: 'software' } }),
    201
  )
  expect(space.usesSprints).toBe(true)
  spaceId = space.id
  states = (await ok<{ states: State[] }>(admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` }))).states
  await ok(admin({ method: 'PATCH', path: `/spaces/${spaceId}`, body: { estimation: 'points' } }))
})

describe('planning', () => {
  it('numbers and dates a new sprint after the last one, for as long as it lasted', async () => {
    const first = await newSprint({ startsOn: '2026-09-28', endsOn: '2026-10-16' })
    const second = await newSprint()

    expect(first).toMatchObject({ number: 1, name: 'Sprint 1', state: 'planned' })
    expect(second).toMatchObject({ number: 2, name: 'Sprint 2', startsOn: '2026-10-17', endsOn: '2026-11-04' })
  })

  it('starts a first sprint today in São Paulo, for two weeks', async () => {
    now = new Date('2026-10-24T01:00:00Z')
    expect(await newSprint()).toMatchObject({ startsOn: '2026-10-23', endsOn: '2026-11-06' })
  })

  it('moves cards in and out, lists them by sprint, and keeps each move in the card’s history', async () => {
    const sprint = await newSprint()
    const card = await newCard('Rastreio', 3)
    await newCard('Fica no backlog')
    await plan(card.id, sprint.id)

    const inSprint = await ok<{ items: Card[] }>(
      admin({ method: 'GET', path: `/spaces/${spaceId}/cards`, query: { sprint: sprint.id } })
    )
    const backlog = await ok<{ items: Card[] }>(
      admin({ method: 'GET', path: `/spaces/${spaceId}/cards`, query: { sprint: 'none' } })
    )
    expect(inSprint.items.map((each) => each.key)).toEqual([card.key])
    expect(backlog.items.map((each) => each.key)).not.toContain(card.key)
    const history = await ok<{ items: { changes: Record<string, unknown> }[] }>(
      admin({ method: 'GET', path: `/cards/${card.id}/history` })
    )
    expect(history.items.some((each) => 'sprintId' in each.changes)).toBe(true)
  })

  it('refuses a sprint of another space, and a space that does not use sprints', async () => {
    const other = await ok<{ id: string }>(
      admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery', type: 'business' } }),
      201
    )
    const sprint = await newSprint()
    const card = await ok<Card>(admin({ method: 'POST', path: `/spaces/${other.id}/cards`, body: { title: 'X' } }), 201)

    expect((await admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { sprintId: sprint.id } })).status).toBe(
      400
    )
    expect((await admin({ method: 'POST', path: `/spaces/${other.id}/sprints`, body: {} })).status).toBe(409)
  })

  it('deletes a planned sprint, sending its cards back to the backlog', async () => {
    const sprint = await newSprint()
    const card = await newCard('Rastreio')
    await plan(card.id, sprint.id)
    await ok(admin({ method: 'DELETE', path: `/sprints/${sprint.id}` }), 204)

    expect((await ok<Card>(admin({ method: 'GET', path: `/cards/${card.id}` }))).sprintId).toBeNull()
  })
})

describe('a sprint’s life', () => {
  it('starts one sprint at a time and takes what it holds as committed', async () => {
    const first = await newSprint()
    const second = await newSprint()
    await plan((await newCard('A', 2)).id, first.id)
    await plan((await newCard('B', 3)).id, first.id)

    const started = await ok<Sprint>(
      admin({ method: 'POST', path: `/sprints/${first.id}/start`, body: { name: 'Sprint 18' } })
    )
    expect(started).toMatchObject({ state: 'active', name: 'Sprint 18', committed: { cards: 2, points: 5 } })
    expect((await admin({ method: 'POST', path: `/sprints/${second.id}/start`, body: {} })).status).toBe(409)
    const active = await ok<{ items: Card[] }>(
      admin({ method: 'GET', path: `/spaces/${spaceId}/cards`, query: { sprint: 'active' } })
    )
    expect(active.items).toHaveLength(2)
  })

  it('closes: done cards stay, open ones go to a new sprint, and the sprint keeps the tally', async () => {
    const sprint = await newSprint()
    const done = await newCard('Feito', 5)
    const open = await newCard('Aberto', 3)
    await plan(done.id, sprint.id)
    await plan(open.id, sprint.id)
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))
    await ok(admin({ method: 'PATCH', path: `/cards/${done.id}`, body: { stateId: stateIn('done').id } }))

    const closed = await ok<Sprint>(
      admin({ method: 'POST', path: `/sprints/${sprint.id}/close`, body: { openCardsTo: 'new' } })
    )
    expect(closed).toMatchObject({
      state: 'closed',
      completed: { cards: 1, points: 5 },
      carried: { cards: 1, points: 3 }
    })
    const sprints = await ok<{ items: Sprint[] }>(admin({ method: 'GET', path: `/spaces/${spaceId}/sprints` }))
    const next = sprints.items.find((each) => each.number === 2) as Sprint
    expect(next.state).toBe('planned')
    expect((await ok<Card>(admin({ method: 'GET', path: `/cards/${open.id}` }))).sprintId).toBe(next.id)
    expect((await ok<Card>(admin({ method: 'GET', path: `/cards/${done.id}` }))).sprintId).toBe(sprint.id)
  })

  it('carries open cards to the next planned sprint, or says there is none', async () => {
    const sprint = await newSprint()
    await plan((await newCard('Aberto')).id, sprint.id)
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))

    expect(
      (await admin({ method: 'POST', path: `/sprints/${sprint.id}/close`, body: { openCardsTo: 'next' } })).status
    ).toBe(409)
    const next = await newSprint()
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/close`, body: { openCardsTo: 'next' } }))
    const inNext = await ok<{ items: Card[] }>(
      admin({ method: 'GET', path: `/spaces/${spaceId}/cards`, query: { sprint: next.id } })
    )
    expect(inNext.items).toHaveLength(1)
  })

  it('refuses a closed sprint to cards and to changes', async () => {
    const sprint = await newSprint()
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/close`, body: { openCardsTo: 'backlog' } }))
    const card = await newCard('Tarde demais')

    expect((await admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { sprintId: sprint.id } })).status).toBe(
      409
    )
    expect((await admin({ method: 'PATCH', path: `/sprints/${sprint.id}`, body: { goal: 'x' } })).status).toBe(409)
  })
})

describe('who runs sprints', () => {
  it('lets a member of the space run them, and a reader only see them', async () => {
    const member = await ok<{ id: string }>(
      admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }),
      201
    )
    await ana({ method: 'GET', path: '/me' })
    expect((await ana({ method: 'POST', path: `/spaces/${spaceId}/sprints`, body: {} })).status).toBe(403)
    expect((await ana({ method: 'GET', path: `/spaces/${spaceId}/sprints` })).status).toBe(200)

    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role: 'member' } }))
    expect((await ana({ method: 'POST', path: `/spaces/${spaceId}/sprints`, body: {} })).status).toBe(201)
  })
})

describe('a sprint past its end date', () => {
  it('tells the space’s lead once, the morning after, by e-mail', async () => {
    const sprint = await newSprint({ startsOn: '2026-10-01', endsOn: '2026-10-22' })
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))

    expect(await service.sprints.sweepLate()).toEqual({ late: 1 })
    expect(await service.sprints.sweepLate()).toEqual({ late: 0 })
    await service.drain()
    await service.mail.sendDue()
    expect(mailer.sent).toEqual([
      expect.objectContaining({ to: 'admin@uselets.com', subject: 'Sprint 1 de Delivery Board passou da data de fim' })
    ])
  })
})

describe('the sprint reports (Etapa 3c)', () => {
  type Burndown = {
    kind: 'burndown'
    unit: string
    sprint: { name: string } | null
    days: { day: string; remaining: number | null; scope: number | null }[]
  }
  type Velocity = {
    kind: 'velocity'
    unit: string
    sprints: { name: string; committed: number; completed: number }[]
    averageCompleted: number | null
  }
  const run = async <T>(widget: Record<string, unknown>) =>
    await ok<T>(
      admin({
        method: 'POST',
        path: `/spaces/${spaceId}/reports/run`,
        body: { widget: { id: '00000000-0000-4000-8000-000000000099', width: 'half', ...widget } }
      })
    )
  const later = (hours: number) => {
    now = new Date(now.getTime() + hours * 3_600_000)
  }

  it('burns the active sprint down day by day, in points, from the history', async () => {
    const sprint = await newSprint({ startsOn: '2026-10-23', endsOn: '2026-10-27' })
    const done = await newCard('Feito', 5)
    await plan(done.id, sprint.id)
    await plan((await newCard('Aberto', 3)).id, sprint.id)
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))
    later(24)
    await ok(admin({ method: 'PATCH', path: `/cards/${done.id}`, body: { stateId: stateIn('done').id } }))

    const report = await run<Burndown>({ kind: 'burndown' })
    expect(report.unit).toBe('points')
    expect(report.days).toEqual([
      { day: '2026-10-23', remaining: 8, scope: 8 },
      { day: '2026-10-24', remaining: 3, scope: 8 },
      { day: '2026-10-25', remaining: null, scope: null },
      { day: '2026-10-26', remaining: null, scope: null },
      { day: '2026-10-27', remaining: null, scope: null }
    ])
  })

  it('filters cards by sprint: the active one, one by id, or the backlog', async () => {
    const sprint = await newSprint()
    const planned = await newCard('Na sprint')
    await plan(planned.id, sprint.id)
    const loose = await newCard('No backlog')
    await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))
    const search = async (sprints: string[]) =>
      (
        await ok<{ items: Card[] }>(
          admin({ method: 'POST', path: '/cards/search', body: { filter: { spaceIds: [spaceId], sprints } } })
        )
      ).items.map((each) => each.key)

    expect(await search(['active'])).toEqual([planned.key])
    expect(await search([sprint.id])).toEqual([planned.key])
    expect(await search(['none'])).toEqual([loose.key])
  })

  it('says there is no sprint to burn down when none runs', async () => {
    expect(await run<Burndown>({ kind: 'burndown' })).toMatchObject({ sprint: null, days: [] })
  })

  it('compares committed and completed over the last closed sprints, oldest first', async () => {
    for (const [points, finish] of [
      [5, true],
      [8, false]
    ] as const) {
      const sprint = await newSprint()
      const card = await newCard(`Card de ${points}`, points)
      await plan(card.id, sprint.id)
      await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} }))
      if (finish) {
        await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { stateId: stateIn('done').id } }))
      }
      await ok(admin({ method: 'POST', path: `/sprints/${sprint.id}/close`, body: { openCardsTo: 'backlog' } }))
    }

    const report = await run<Velocity>({ kind: 'velocity', sprints: 6 })
    expect(report.sprints.map((each) => [each.name, each.committed, each.completed])).toEqual([
      ['Sprint 1', 5, 5],
      ['Sprint 2', 8, 0]
    ])
    expect(report.averageCompleted).toBe(2.5)
  })

  it('opens a sprint space’s default dashboard with the burndown and the velocity', async () => {
    const dashboard = await ok<{ widgets: { kind: string }[] }>(
      admin({ method: 'GET', path: `/spaces/${spaceId}/dashboard` })
    )
    expect(dashboard.widgets.slice(0, 2).map((each) => each.kind)).toEqual(['burndown', 'velocity'])
  })
})
