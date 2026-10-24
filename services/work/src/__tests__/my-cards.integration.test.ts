import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import type { MyCard, MyCardTab } from '../personal/my-cards.schemas.js'

/** "Suas tarefas" on Para você: the caller's cards, three ways. */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const ANA = 'ana@uselets.com'

type State = { id: string; group: string }

let clock: ReturnType<typeof fixedClock>
let service: ReturnType<typeof buildService>
let spaceId: string
let anaId: string
let states: State[]

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as(ANA)

const createCard = async (title: string, extra: Record<string, unknown> = {}) => {
  const created = await admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title, ...extra } })
  expect(created.status).toBe(201)
  clock.advance(1000)
  return created.body as { id: string; key: string }
}

const titles = async (tab: MyCardTab, who = ana) => {
  const listed = await who({ method: 'GET', path: '/me/cards', query: { tab } })
  expect(listed.status).toBe(200)
  return (listed.body as { items: MyCard[] }).items.map((card) => card.title)
}

const me = async (who: typeof ana) => (await who({ method: 'GET', path: '/me' })).body as { id: string }

const giveAnaRole = async (role: string) => {
  const member = (await admin({ method: 'POST', path: '/members', body: { email: ANA, name: 'Ana' } })).body as {
    id: string
  }
  await admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role } })
  return member.id
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-15T12:00:00.000Z'))
  service = buildService(config, { db, clock })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (
    await admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery Board', type: 'software' } })
  ).body as { id: string }
  spaceId = space.id
  states = ((await admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` })).body as { states: State[] }).states
  anaId = await giveAnaRole('member')
})

describe('GET /me/cards?tab=assigned', () => {
  it('lists open cards assigned to the caller, most urgent first', async () => {
    const done = states.find((state) => state.group === 'done') as State
    await createCard('Baixa', { assigneeId: anaId, priority: 'low' })
    await createCard('Urgente', { assigneeId: anaId, priority: 'highest' })
    await createCard('Já feito', { assigneeId: anaId, stateId: done.id })
    await createCard('De outra pessoa')

    expect(await titles('assigned')).toEqual(['Urgente', 'Baixa'])
  })
})

describe('GET /me/cards?tab=starred', () => {
  it('lists the cards the caller starred, and forgets an unstarred one', async () => {
    const card = await createCard('Painel de SLA')
    await createCard('Sem estrela')

    expect((await ana({ method: 'PUT', path: `/cards/${card.id}/star` })).body).toEqual({ starred: true })
    expect((await ana({ method: 'GET', path: `/cards/${card.id}/star` })).body).toEqual({ starred: true })
    expect((await admin({ method: 'GET', path: `/cards/${card.id}/star` })).body).toEqual({ starred: false })
    expect(await titles('starred')).toEqual(['Painel de SLA'])

    await ana({ method: 'DELETE', path: `/cards/${card.id}/star` })
    expect(await titles('starred')).toEqual([])
  })

  it('refuses to star a card that does not exist', async () => {
    const missing = await ana({ method: 'PUT', path: `/cards/${crypto.randomUUID()}/star` })
    expect(missing.status).toBe(404)
  })
})

describe('GET /me/cards?tab=recommended', () => {
  const startSprint = async () => {
    const sprint = (await admin({ method: 'POST', path: `/spaces/${spaceId}/sprints`, body: {} })).body as {
      id: string
    }
    expect((await admin({ method: 'POST', path: `/sprints/${sprint.id}/start`, body: {} })).status).toBe(200)
    return sprint.id
  }

  it('recommends what the active sprint has not started yet, never the backlog, most urgent first', async () => {
    const sprintId = await startSprint()
    const doing = states.find((state) => state.group === 'in_progress') as State
    await createCard('Na sprint, baixa', { sprintId, priority: 'low' })
    await createCard('Na sprint, urgente', { sprintId, priority: 'highest' })
    await createCard('Na sprint, minha', { sprintId, assigneeId: anaId })
    await createCard('Na sprint, de outra pessoa', { sprintId, assigneeId: (await me(admin)).id })
    await createCard('Na sprint, em andamento', { sprintId, stateId: doing.id })
    await createCard('No backlog', { priority: 'highest' })

    expect(await titles('recommended')).toEqual(['Na sprint, urgente', 'Na sprint, minha', 'Na sprint, baixa'])
  })

  it('holds back a card blocked by one still open, and offers it once the blocker is done', async () => {
    const sprintId = await startSprint()
    const done = states.find((state) => state.group === 'done') as State
    const blocker = await createCard('Bloqueador', { sprintId, assigneeId: (await me(admin)).id })
    const blocked = await createCard('Depende do bloqueador', { sprintId })
    const link = await admin({
      method: 'POST',
      path: `/cards/${blocker.id}/links`,
      body: { type: 'blocks', key: blocked.key }
    })
    expect(link.status).toBe(201)

    expect(await titles('recommended')).toEqual([])
    await admin({ method: 'POST', path: `/cards/${blocker.id}/move`, body: { stateId: done.id, index: 0 } })
    expect(await titles('recommended')).toEqual(['Depende do bloqueador'])
  })

  it('recommends nothing from a space where the caller holds no role', async () => {
    const sprintId = await startSprint()
    await createCard('Na sprint', { sprintId })
    const outsider = as('bia@uselets.com')
    await admin({ method: 'POST', path: '/members', body: { email: 'bia@uselets.com', name: 'Bia' } })

    expect(await titles('recommended', outsider)).toEqual([])
    expect(await titles('recommended')).toEqual(['Na sprint'])
  })
})
