import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/** Filters on every field (3.4), text search and keys (3.6), and changing many cards at once (3.8). */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Card = { id: string; key: string; labels: string[]; stateId: string; assignee: { id: string } | null }
type Space = { id: string }
type Workflow = { states: { id: string; name: string }[]; types: { id: string; name: string }[] }

let service: ReturnType<typeof buildService>
let clock: ReturnType<typeof fixedClock>
let prd: Space
let tec: Space

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const createSpace = async (key: string, type: string) =>
  (await ok(admin({ method: 'POST', path: '/spaces', body: { key, name: key, type } }), 201)) as Space

const createCard = async (space: Space, title: string, extra: Record<string, unknown> = {}) => {
  clock.advance(60_000)
  return (await ok(
    admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body: { title, ...extra } }),
    201
  )) as Card
}

const stateOf = async (space: Space, name: string) => {
  const workflow = (await ok(admin({ method: 'GET', path: `/spaces/${space.id}/workflow` }))) as Workflow
  return workflow.states.find((state) => state.name === name)?.id ?? ''
}

const find = async (filter: Record<string, unknown>, who = admin) =>
  (
    (await ok(who({ method: 'POST', path: '/cards/search', body: { filter, order: { by: 'key' } } }))) as {
      items: Card[]
    }
  ).items.map((each) => each.key)

const giveRole = async (email: string, role: string, space: Space) => {
  const member = (await admin({ method: 'POST', path: '/members', body: { email, name: email } })).body as {
    id: string
  }
  await admin({ method: 'PUT', path: `/spaces/${space.id}/members/${member.id}`, body: { role } })
  return member.id
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-01T12:00:00.000Z'))
  service = buildService(config, { db, clock, files: new InMemoryFileStore() })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "Let's", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  prd = await createSpace('PRD', 'product_discovery')
  tec = await createSpace('TEC', 'software')
})

describe('filters', () => {
  it('by assignee — me, someone, nobody — priority and state group', async () => {
    const ana = await giveRole('ana@uselets.com', 'member', prd)
    await createCard(prd, 'Da Ana', { assigneeId: ana, priority: 'high' })
    await createCard(prd, 'Sem ninguém', { priority: 'low' })
    const me = (await ok(admin({ method: 'GET', path: '/me' }))) as { id: string }
    await createCard(prd, 'Meu', { assigneeId: me.id, priority: 'high' })

    expect(await find({ assignees: ['me'] })).toEqual(['PRD-3'])
    expect(await find({ assignees: [ana, 'none'] })).toEqual(['PRD-1', 'PRD-2'])
    expect(await find({ priorities: ['high'], stateGroups: ['not_started'] })).toEqual(['PRD-1', 'PRD-3'])
    expect(await find({ assignees: ['me'] }, as('ana@uselets.com'))).toEqual(['PRD-1'])
  })

  it('by created, updated and due dates, absolute or relative to now', async () => {
    const early = await createCard(prd, 'Antigo')
    clock.advance(10 * 86_400_000)
    await createCard(prd, 'Recente')
    await ok(admin({ method: 'PATCH', path: `/cards/${early.id}`, body: { dueDate: '2026-10-20' } }))

    expect(await find({ created: { from: '-3d' } })).toEqual(['PRD-2'])
    expect(await find({ created: { to: '2026-10-01' } })).toEqual(['PRD-1'])
    expect(await find({ updated: { from: '-1d' } })).toEqual(['PRD-1', 'PRD-2'])
    expect(await find({ due: { from: '2026-10-20', to: '2026-10-20' } })).toEqual(['PRD-1'])
  })

  it('by a custom field, one value or any of a multiple selection', async () => {
    const squad = (await ok(
      admin({
        method: 'POST',
        path: `/spaces/${prd.id}/fields`,
        body: { name: 'Squad', kind: 'select', options: ['Core', 'Growth'] }
      }),
      201
    )) as { id: string }
    const areas = (await ok(
      admin({
        method: 'POST',
        path: `/spaces/${prd.id}/fields`,
        body: { name: 'Áreas', kind: 'multi_select', options: ['CS', 'Ops'] }
      }),
      201
    )) as { id: string }
    const core = await createCard(prd, 'Core')
    const both = await createCard(prd, 'Growth com CS')
    await createCard(prd, 'Sem campos')
    await admin({ method: 'PATCH', path: `/cards/${core.id}`, body: { customFields: { [squad.id]: 'Core' } } })
    await admin({
      method: 'PATCH',
      path: `/cards/${both.id}`,
      body: { customFields: { [squad.id]: 'Growth', [areas.id]: ['CS', 'Ops'] } }
    })

    expect(await find({ fields: [{ fieldId: squad.id, anyOf: ['Core'] }] })).toEqual(['PRD-1'])
    expect(await find({ fields: [{ fieldId: areas.id, anyOf: ['Ops'] }] })).toEqual(['PRD-2'])
  })

  it('by text in the title or description, or a key; a typed % is not a wildcard', async () => {
    await createCard(prd, 'Rastreio em tempo real')
    await createCard(prd, 'Cobrança', { description: 'Depende do rastreio do pedido' })
    await createCard(prd, 'Desconto de 10%')

    expect(await find({ text: 'RASTREIO' })).toEqual(['PRD-1', 'PRD-2'])
    expect(await find({ text: 'prd-3' })).toEqual(['PRD-3'])
    expect(await find({ text: '10%' })).toEqual(['PRD-3'])
    expect(await find({ text: '%' })).toEqual(['PRD-3'])
  })

  it('across spaces, a member finds cards of every space, role or not (ADR-0012)', async () => {
    await giveRole('ana@uselets.com', 'member', prd)
    await createCard(prd, 'No PRD')
    await createCard(tec, 'No TEC')

    expect(await find({})).toEqual(['PRD-1', 'TEC-1'])
    expect(await find({}, as('ana@uselets.com'))).toEqual(['PRD-1', 'TEC-1'])
  })
})

describe('text search', () => {
  it('finds a key exactly, titles and descriptions, and comments — one line per card', async () => {
    const tracking = await createCard(prd, 'Rastreio em tempo real')
    const billing = await createCard(prd, 'Cobrança')
    await ok(
      admin({ method: 'POST', path: `/cards/${billing.id}/comments`, body: { body: 'Ver o rastreio antes' } }),
      201
    )
    await ok(admin({ method: 'POST', path: `/cards/${tracking.id}/comments`, body: { body: 'rastreio ok' } }), 201)

    const found = (await ok(admin({ method: 'GET', path: '/search', query: { q: 'rastreio' } }))) as {
      exact: unknown
      items: { card: { key: string }; match: string; excerpt: string }[]
    }
    const byKey = (await ok(admin({ method: 'GET', path: '/search', query: { q: 'prd-2' } }))) as {
      exact: { key: string; title: string } | null
    }

    expect(found.exact).toBeNull()
    expect(found.items.map((each) => [each.card.key, each.match])).toEqual([
      ['PRD-1', 'title'],
      ['PRD-2', 'comment']
    ])
    expect(found.items[1]?.excerpt).toBe('Ver o rastreio antes')
    expect(byKey.exact).toMatchObject({ key: 'PRD-2', title: 'Cobrança' })
  })

  it('finds for a member with no role every card, by text and by key', async () => {
    await createCard(prd, 'Rastreio do Gil')
    await createCard(prd, 'Rastreio de outro')
    await ok(admin({ method: 'POST', path: '/members', body: { email: 'gil@uselets.com', name: 'Gil' } }), 201)
    const search = (q: string) =>
      ok(as('gil@uselets.com')({ method: 'GET', path: '/search', query: { q } })) as Promise<{
        exact: { key: string } | null
        items: { card: { key: string } }[]
      }>

    expect((await search('rastreio')).items.map((each) => each.card.key).sort()).toEqual(['PRD-1', 'PRD-2'])
    expect((await search('PRD-2')).exact).toMatchObject({ key: 'PRD-2' })
  })
})

describe('bulk edit', () => {
  it('moves, assigns and relabels many cards, one line of history each', async () => {
    const ana = await giveRole('ana@uselets.com', 'member', prd)
    const first = await createCard(prd, 'Um', { labels: ['velho', 'okr-saude-escala'] })
    const second = await createCard(prd, 'Dois')
    const priorizado = await stateOf(prd, 'Em descoberta')
    const body = {
      cardIds: [first.id, second.id],
      changes: { stateId: priorizado, assigneeId: ana, addLabels: ['okr-novos-clientes'], removeLabels: ['velho'] }
    }

    const edited = (await ok(admin({ method: 'POST', path: '/cards/bulk', body }))) as { items: Card[] }
    const history = (await ok(admin({ method: 'GET', path: `/cards/${first.id}/history` }))) as {
      items: { action: string; changes: Record<string, unknown> }[]
    }

    expect(edited.items.map((each) => [each.stateId, each.assignee?.id, each.labels])).toEqual([
      [priorizado, ana, ['okr-saude-escala', 'okr-novos-clientes']],
      [priorizado, ana, ['okr-novos-clientes']]
    ])
    expect(history.items.at(-1)?.action).toBe('updated')
    expect(Object.keys(history.items.at(-1)?.changes ?? {}).sort()).toEqual(['assigneeId', 'labels', 'stateId'])
  })

  it('changes nothing when one card cannot be changed, or a state is sent to cards of two spaces', async () => {
    await giveRole('ana@uselets.com', 'member', prd)
    const mine = await createCard(prd, 'No PRD')
    const other = await createCard(tec, 'No TEC')
    const asAna = as('ana@uselets.com')
    const labels = { cardIds: [mine.id, other.id], changes: { addLabels: ['x'] } }
    const state = { cardIds: [mine.id, other.id], changes: { stateId: await stateOf(prd, 'Em descoberta') } }

    expect((await asAna({ method: 'POST', path: '/cards/bulk', body: labels })).status).toBe(403)
    expect((await admin({ method: 'POST', path: '/cards/bulk', body: state })).status).toBe(400)
    const after = (await ok(admin({ method: 'GET', path: `/cards/${mine.id}` }))) as Card
    expect(after.labels).toEqual([])
  })
})
