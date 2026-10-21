import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/** The board: a space's workflow, its cards, their order, their history (escopo-mvp 2.x, 3.1). */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type State = { id: string; name: string; group: string }
type Card = { id: string; key: string; stateId: string; rank: number; title: string }

let service: ReturnType<typeof buildService>
let spaceId: string
let states: State[]

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const createCard = async (title: string, extra: Record<string, unknown> = {}) => {
  const created = await admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title, ...extra } })
  expect(created.status).toBe(201)
  return created.body as Card
}

const board = async (email = 'admin@uselets.com') =>
  ((await as(email)({ method: 'GET', path: `/spaces/${spaceId}/cards` })).body as { items: Card[] }).items

const giveRole = async (email: string, role: string) => {
  const member = (await admin({ method: 'POST', path: '/members', body: { email, name: email } })).body as {
    id: string
  }
  await admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role } })
  return member.id
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (
    await admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery Board', type: 'business' } })
  ).body as { id: string }
  spaceId = space.id
  states = ((await admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` })).body as { states: State[] }).states
})

describe('workflow', () => {
  it('gives a new space the default workflow of its type, in board order', async () => {
    expect(states.map((state) => [state.name, state.group])).toEqual([
      ['A fazer', 'not_started'],
      ['Em andamento', 'in_progress'],
      ['Concluído', 'done']
    ])
  })

  it('adds a state with emoji in its name, renames it, and reorders the board', async () => {
    const added = await admin({
      method: 'POST',
      path: `/spaces/${spaceId}/states`,
      body: { name: '🚨 Bloqueado', group: 'in_progress' }
    })
    const blocked = (added.body as { states: State[] }).states.find((state) => state.name === '🚨 Bloqueado') as State
    await admin({ method: 'PATCH', path: `/spaces/${spaceId}/states/${blocked.id}`, body: { name: '🚧 Bloqueado' } })
    const order = [blocked.id, ...states.map((state) => state.id)]

    const reordered = await admin({ method: 'PUT', path: `/spaces/${spaceId}/states/order`, body: { stateIds: order } })

    expect((reordered.body as { states: State[] }).states.map((state) => state.name)).toEqual([
      '🚧 Bloqueado',
      'A fazer',
      'Em andamento',
      'Concluído'
    ])
  })

  it('refuses deleting a state that holds cards unless told where they go, then moves them', async () => {
    const [todo, doing] = states as [State, State]
    const card = await createCard('Painel de SLA', { stateId: todo.id })

    expect((await admin({ method: 'DELETE', path: `/spaces/${spaceId}/states/${todo.id}` })).status).toBe(409)
    const deleted = await admin({
      method: 'DELETE',
      path: `/spaces/${spaceId}/states/${todo.id}`,
      query: { moveTo: doing.id }
    })

    expect((deleted.body as { states: State[] }).states.map((state) => state.name)).toEqual([
      'Em andamento',
      'Concluído'
    ])
    expect((await admin({ method: 'GET', path: `/cards/${card.id}` })).body).toMatchObject({ stateId: doing.id })
  })

  it('keeps workflow changes to the space admins', async () => {
    await giveRole('ana@uselets.com', 'member')

    const refused = await as('ana@uselets.com')({
      method: 'POST',
      path: `/spaces/${spaceId}/states`,
      body: { name: 'X', group: 'done' }
    })

    expect(refused.status).toBe(403)
  })
})

describe('cards', () => {
  it('numbers cards from the space key, starts them in the first state and moves the space activity', async () => {
    const first = await createCard('Rastreio em tempo real')
    const second = await createCard('Cotação por região')
    const space = (await admin({ method: 'GET', path: `/spaces/${spaceId}` })).body as {
      lastCardActivityAt: string | null
    }

    expect([first.key, second.key]).toEqual(['PRD-1', 'PRD-2'])
    expect(first.stateId).toBe(states[0]?.id ?? '')
    expect(space.lastCardActivityAt).not.toBeNull()
  })

  it('never hands the same number to two cards created at once', async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) => createCard(`Card ${index}`)))
    const keys = created.map((card) => card.key)

    expect(new Set(keys).size).toBe(8)
  })

  it('moves a card between states and to a position, and keeps the board order', async () => {
    const [todo, doing] = states as [State, State]
    const a = await createCard('A', { stateId: doing.id })
    const b = await createCard('B', { stateId: doing.id })
    const c = await createCard('C', { stateId: todo.id })

    await admin({ method: 'POST', path: `/cards/${c.id}/move`, body: { stateId: doing.id, index: 1 } })
    await admin({ method: 'POST', path: `/cards/${b.id}/move`, body: { stateId: doing.id, index: 0 } })

    const column = (await board()).filter((card) => card.stateId === doing.id).map((card) => card.title)
    expect(column).toEqual(['B', 'A', 'C'])
    expect(a.id).toBeDefined()
  })

  it('records each changed field in the card history', async () => {
    const card = await createCard('Painel de SLA')
    const ana = await giveRole('ana@uselets.com', 'member')

    await admin({
      method: 'PATCH',
      path: `/cards/${card.id}`,
      body: { priority: 'highest', assigneeId: ana, labels: ['okr-saude-escala'] }
    })
    await admin({ method: 'POST', path: `/cards/${card.id}/move`, body: { stateId: states[2]?.id, index: 0 } })

    const history = (await admin({ method: 'GET', path: `/cards/${card.id}/history` })).body as {
      items: { action: string; changes: Record<string, { before: unknown; after: unknown }> }[]
    }
    expect(history.items.map((event) => event.action)).toEqual(['created', 'updated', 'moved'])
    expect(history.items[1]?.changes).toEqual({
      priority: { before: 'medium', after: 'highest' },
      assigneeId: { before: null, after: ana },
      labels: { before: [], after: ['okr-saude-escala'] }
    })
  })

  it('gives a card the group that owns it, records it, and clears it', async () => {
    const card = await createCard('Trava para pedidos agrupados')
    const group = (await admin({ method: 'POST', path: '/groups', body: { name: 'Squad Max' } })).body as { id: string }

    const owned = await admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { groupId: group.id } })
    const cleared = await admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { groupId: null } })

    expect((owned.body as { group: unknown }).group).toEqual({ id: group.id, name: 'Squad Max' })
    expect((cleared.body as { group: unknown }).group).toBeNull()
    const history = (await admin({ method: 'GET', path: `/cards/${card.id}/history` })).body as {
      items: { changes: Record<string, unknown> }[]
    }
    expect(history.items[1]?.changes).toEqual({ groupId: { before: null, after: group.id } })
  })

  it('refuses a group the organization does not have', async () => {
    const card = await createCard('Painel de SLA')
    const missing = '00000000-0000-4000-8000-000000000000'

    const refused = await admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { groupId: missing } })

    expect(refused.status).toBe(404)
    expect(JSON.stringify(refused.body)).toContain(missing)
  })

  it('refuses a state or a type of another space', async () => {
    const other = (
      await admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery', type: 'software' } })
    ).body as {
      id: string
    }
    const foreign = ((await admin({ method: 'GET', path: `/spaces/${other.id}/workflow` })).body as { states: State[] })
      .states[0]

    const refused = await admin({
      method: 'POST',
      path: `/spaces/${spaceId}/cards`,
      body: { title: 'x', stateId: foreign?.id }
    })

    expect(refused.status).toBe(400)
  })

  it('refuses new cards in an archived space', async () => {
    await admin({ method: 'POST', path: `/spaces/${spaceId}/archive` })

    expect((await admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title: 'x' } })).status).toBe(409)
  })
})

describe('roles on the board', () => {
  it('lets a reader read and comment, but not create or move', async () => {
    await giveRole('rui@uselets.com', 'reader')
    const card = await createCard('Painel de SLA')
    const rui = as('rui@uselets.com')

    expect((await rui({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title: 'x' } })).status).toBe(403)
    expect(
      (await rui({ method: 'POST', path: `/cards/${card.id}/move`, body: { stateId: states[1]?.id, index: 0 } })).status
    ).toBe(403)
    const commented = await rui({
      method: 'POST',
      path: `/cards/${card.id}/comments`,
      body: { body: 'Faz sentido para o CS.' }
    })
    expect(commented).toMatchObject({
      status: 201,
      body: { items: [{ author: { name: 'rui@uselets.com' }, body: 'Faz sentido para o CS.' }] }
    })
  })
})
