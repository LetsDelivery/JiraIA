import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/** What a card carries beyond its standard fields: custom values, hierarchy, links, talk, files (2.5–2.14). */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Card = { id: string; key: string; spaceId: string; parentId: string | null; customFields: Record<string, unknown> }
type Space = { id: string }
type Workflow = { states: { id: string; name: string; group: string }[]; types: { id: string; name: string }[] }

let service: ReturnType<typeof buildService>
let files: InMemoryFileStore
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

const createCard = async (space: Space, title: string, extra: Record<string, unknown> = {}) =>
  (await ok(admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body: { title, ...extra } }), 201)) as Card

const createSpace = async (key: string, type: string) =>
  (await ok(admin({ method: 'POST', path: '/spaces', body: { key, name: key, type } }), 201)) as Space

const workflow = async (space: Space) =>
  (await ok(admin({ method: 'GET', path: `/spaces/${space.id}/workflow` }))) as Workflow

const giveRole = async (email: string, role: string, space: Space) => {
  const member = (await admin({ method: 'POST', path: '/members', body: { email, name: email } })).body as {
    id: string
  }
  await admin({ method: 'PUT', path: `/spaces/${space.id}/members/${member.id}`, body: { role } })
  return member.id
}

const history = async (card: Card) =>
  (
    (await ok(admin({ method: 'GET', path: `/cards/${card.id}/history` }))) as {
      items: { action: string; changes: Record<string, { before: unknown; after: unknown }> }[]
    }
  ).items

beforeEach(async () => {
  await truncateSchema(db, 'work')
  files = new InMemoryFileStore()
  service = buildService(config, { db, files })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "Let's", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  prd = await createSpace('PRD', 'product_discovery')
  tec = await createSpace('TEC', 'software')
})

describe('custom fields', () => {
  const addField = async (body: Record<string, unknown>) =>
    (await ok(admin({ method: 'POST', path: `/spaces/${prd.id}/fields`, body }), 201)) as { id: string }

  it('sets a value of the field kind, records it field by field, and refuses a wrong one', async () => {
    const squad = await addField({ name: 'Squad', kind: 'select', options: ['Core', 'Growth'] })
    const impact = await addField({ name: 'Impacto', kind: 'number' })
    const card = await createCard(prd, 'Rastreio em tempo real')

    const updated = (await ok(
      admin({
        method: 'PATCH',
        path: `/cards/${card.id}`,
        body: { customFields: { [squad.id]: 'Core', [impact.id]: 8 } }
      })
    )) as Card
    const refused = await admin({
      method: 'PATCH',
      path: `/cards/${card.id}`,
      body: { customFields: { [squad.id]: 'Ops' } }
    })

    expect(updated.customFields).toEqual({ [squad.id]: 'Core', [impact.id]: 8 })
    expect(refused.status).toBe(400)
    expect((await history(card)).at(-1)?.changes).toEqual({
      [`field:${squad.id}`]: { before: null, after: 'Core' },
      [`field:${impact.id}`]: { before: null, after: 8 }
    })
  })

  it('keeps a field to the types it shows on', async () => {
    const types = (await workflow(tec)).types
    const story = types.find((type) => type.name === 'História')?.id
    const bug = types.find((type) => type.name === 'Bug')?.id
    const steps = (await ok(
      admin({
        method: 'POST',
        path: `/spaces/${tec.id}/fields`,
        body: { name: 'Passos', kind: 'text', typeIds: [bug] }
      }),
      201
    )) as { id: string }
    const card = await createCard(tec, 'Login lento', { typeId: story })

    const refused = await admin({
      method: 'PATCH',
      path: `/cards/${card.id}`,
      body: { customFields: { [steps.id]: 'x' } }
    })
    const accepted = await admin({
      method: 'PATCH',
      path: `/cards/${card.id}`,
      body: { typeId: bug, customFields: { [steps.id]: '1. abrir' } }
    })

    expect(refused.status).toBe(400)
    expect(accepted.status).toBe(200)
  })

  it('refuses removing an option still chosen, and deleting the field clears every value', async () => {
    const squad = await addField({ name: 'Squad', kind: 'multi_select', options: ['Core', 'Growth'] })
    const card = await createCard(prd, 'Cotação')
    await admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { customFields: { [squad.id]: ['Growth'] } } })
    const path = `/spaces/${prd.id}/fields/${squad.id}`

    expect((await admin({ method: 'PATCH', path, body: { options: ['Core'] } })).status).toBe(409)
    expect((await admin({ method: 'DELETE', path })).status).toBe(204)
    expect(((await ok(admin({ method: 'GET', path: `/cards/${card.id}` }))) as Card).customFields).toEqual({})
  })

  it('keeps the fields to the space admins', async () => {
    await giveRole('ana@uselets.com', 'member', prd)
    const refused = await as('ana@uselets.com')({
      method: 'POST',
      path: `/spaces/${prd.id}/fields`,
      body: { name: 'X', kind: 'text' }
    })
    expect(refused.status).toBe(403)
  })
})

describe('hierarchy', () => {
  it('creates subtasks under a parent and lists them as its children', async () => {
    const epic = await createCard(tec, 'Rastreio')
    const story = await createCard(tec, 'Mapa do entregador', { parentId: epic.id })
    await createCard(tec, 'Endpoint de posição', { parentId: story.id })

    const relations = (await ok(admin({ method: 'GET', path: `/cards/${epic.id}/relations` }))) as {
      children: { key: string }[]
    }
    const below = (await ok(admin({ method: 'GET', path: `/cards/${story.id}/relations` }))) as {
      parent: { key: string }
    }

    expect(relations.children.map((child) => child.key)).toEqual(['TEC-2'])
    expect(below.parent.key).toBe('TEC-1')
  })

  it('refuses a cycle and a parent from another space', async () => {
    const epic = await createCard(tec, 'Rastreio')
    const story = await createCard(tec, 'Mapa', { parentId: epic.id })
    const other = await createCard(prd, 'Oportunidade')

    expect((await admin({ method: 'PATCH', path: `/cards/${epic.id}`, body: { parentId: story.id } })).status).toBe(409)
    expect((await admin({ method: 'PATCH', path: `/cards/${epic.id}`, body: { parentId: epic.id } })).status).toBe(409)
    expect((await admin({ method: 'PATCH', path: `/cards/${story.id}`, body: { parentId: other.id } })).status).toBe(
      400
    )
  })
})

describe('links', () => {
  it('links PRD to TEC by key, shows it from both ends and in both histories', async () => {
    const opportunity = await createCard(prd, 'Rastreio em tempo real')
    const story = await createCard(tec, 'Mapa do entregador')

    await ok(admin({ method: 'POST', path: `/cards/${story.id}/links`, body: { type: 'delivers', key: 'prd-1' } }), 201)
    const fromPrd = (await ok(admin({ method: 'GET', path: `/cards/${opportunity.id}/relations` }))) as {
      links: { type: string; direction: string; card: { key: string } }[]
    }

    expect(fromPrd.links).toMatchObject([{ type: 'delivers', direction: 'inward', card: { key: 'TEC-1' } }])
    expect((await history(opportunity)).at(-1)).toMatchObject({
      action: 'linked',
      changes: { link: { after: { type: 'delivers', from: 'TEC-1', to: 'PRD-1' } } }
    })
    expect((await history(story)).at(-1)?.action).toBe('linked')
  })

  it('refuses the same link twice — "relates" either way round — and a card linked to itself', async () => {
    const a = await createCard(prd, 'A')
    const b = await createCard(prd, 'B')
    const link = (body: Record<string, unknown>, from = a) =>
      admin({ method: 'POST', path: `/cards/${from.id}/links`, body })

    await ok(link({ type: 'relates', cardId: b.id }), 201)
    expect((await link({ type: 'relates', cardId: a.id }, b)).status).toBe(409)
    expect((await link({ type: 'blocks', cardId: a.id })).status).toBe(400)
  })

  it('shows a link to a space the caller holds no role in, and unlinks', async () => {
    const opportunity = await createCard(prd, 'Oportunidade')
    const story = await createCard(tec, 'História')
    await giveRole('rui@uselets.com', 'reader', prd)
    const relations = (await ok(
      admin({ method: 'POST', path: `/cards/${opportunity.id}/links`, body: { type: 'blocks', cardId: story.id } }),
      201
    )) as { links: { id: string }[] }

    const ruiSees = (await ok(
      as('rui@uselets.com')({ method: 'GET', path: `/cards/${opportunity.id}/relations` })
    )) as {
      links: unknown[]
    }
    const removed = (await ok(
      admin({ method: 'DELETE', path: `/cards/${opportunity.id}/links/${relations.links[0]?.id}` })
    )) as { links: unknown[] }

    expect(ruiSees.links).toHaveLength(1)
    expect(removed.links).toEqual([])
  })
})

describe('comments', () => {
  it('mentions a member, who then follows the card; the author edits and the old text stays in history', async () => {
    const ana = await giveRole('ana@uselets.com', 'member', prd)
    const card = await createCard(prd, 'Rastreio')
    const created = (await ok(
      admin({ method: 'POST', path: `/cards/${card.id}/comments`, body: { body: `<@${ana}> pode revisar?` } }),
      201
    )) as { items: { id: string; mentions: { id: string; name: string }[] }[] }
    const commentId = created.items[0]?.id ?? ''

    const edited = (await ok(
      admin({ method: 'PATCH', path: `/cards/${card.id}/comments/${commentId}`, body: { body: 'Revisado.' } })
    )) as { items: { body: string; editedAt: string | null }[] }
    const watchers = (await ok(admin({ method: 'GET', path: `/cards/${card.id}/watchers` }))) as {
      items: { name: string }[]
    }

    expect(created.items[0]?.mentions).toEqual([{ id: ana, name: 'ana@uselets.com' }])
    expect(edited.items[0]).toMatchObject({ body: 'Revisado.', editedAt: expect.any(String) })
    expect(watchers.items.map((watcher) => watcher.name)).toEqual(['Admin', 'ana@uselets.com'])
    expect((await history(card)).at(-1)?.changes.body).toEqual({
      before: `<@${ana}> pode revisar?`,
      after: 'Revisado.'
    })
  })

  it('refuses an edit by anyone but the author and a mention of no one', async () => {
    await giveRole('ana@uselets.com', 'member', prd)
    const card = await createCard(prd, 'Rastreio')
    const created = (await ok(
      admin({ method: 'POST', path: `/cards/${card.id}/comments`, body: { body: 'Primeiro' } }),
      201
    )) as { items: { id: string }[] }
    const path = `/cards/${card.id}/comments/${created.items[0]?.id}`

    expect((await as('ana@uselets.com')({ method: 'PATCH', path, body: { body: 'Meu' } })).status).toBe(403)
    const ghost = `<@${crypto.randomUUID()}>`
    expect((await admin({ method: 'POST', path: `/cards/${card.id}/comments`, body: { body: ghost } })).status).toBe(
      400
    )
  })

  it('lets a reader react and take the reaction back', async () => {
    const rui = await giveRole('rui@uselets.com', 'reader', prd)
    const card = await createCard(prd, 'Rastreio')
    const created = (await ok(
      admin({ method: 'POST', path: `/cards/${card.id}/comments`, body: { body: 'Lançado!' } }),
      201
    )) as { items: { id: string }[] }
    const path = `/cards/${card.id}/comments/${created.items[0]?.id}/reactions`
    const react = (on: boolean) => as('rui@uselets.com')({ method: 'POST', path, body: { emoji: '🎉', on } })

    expect(((await ok(react(true))) as { items: { reactions: unknown }[] }).items[0]?.reactions).toEqual([
      { emoji: '🎉', memberIds: [rui] }
    ])
    expect(((await ok(react(false))) as { items: { reactions: unknown }[] }).items[0]?.reactions).toEqual([])
  })
})

describe('watchers', () => {
  it('starts with the reporter and the assignee, and lets anyone follow or stop', async () => {
    const ana = await giveRole('ana@uselets.com', 'member', prd)
    await giveRole('rui@uselets.com', 'reader', prd)
    const card = await createCard(prd, 'Rastreio', { assigneeId: ana })
    const path = `/cards/${card.id}/watch`

    await ok(as('rui@uselets.com')({ method: 'PUT', path }))
    const after = (await ok(admin({ method: 'DELETE', path }))) as { items: { name: string }[] }

    expect(after.items.map((watcher) => watcher.name)).toEqual(['ana@uselets.com', 'rui@uselets.com'])
  })
})

describe('attachments', () => {
  it('uploads in two steps: pending until the file arrives, then listed and in history', async () => {
    const card = await createCard(prd, 'Rastreio')
    const started = (await ok(
      admin({
        method: 'POST',
        path: `/cards/${card.id}/attachments`,
        body: { name: 'fluxo.png', contentType: 'image/png', size: 120 }
      }),
      201
    )) as { id: string; upload: { url: string } }
    const complete = () => admin({ method: 'POST', path: `/cards/${card.id}/attachments/${started.id}/complete` })

    expect((await complete()).status).toBe(409)
    expect(
      ((await ok(admin({ method: 'GET', path: `/cards/${card.id}/attachments` }))) as { items: [] }).items
    ).toEqual([])
    await files.put(started.upload.url.replace('https://files.counterparty.test/', ''), 120)
    const listed = (await ok(complete())) as { items: { name: string; url: string }[] }

    expect(listed.items).toMatchObject([{ name: 'fluxo.png', url: expect.stringContaining('download') }])
    expect((await history(card)).at(-1)).toMatchObject({ action: 'attached' })
  })

  it('lets only the uploader or a space admin remove a file, and keeps readers from uploading', async () => {
    await giveRole('ana@uselets.com', 'member', prd)
    await giveRole('rui@uselets.com', 'reader', prd)
    const card = await createCard(prd, 'Rastreio')
    const body = { name: 'a.pdf', contentType: 'application/pdf', size: 10 }
    const started = (await ok(admin({ method: 'POST', path: `/cards/${card.id}/attachments`, body }), 201)) as {
      id: string
      upload: { url: string }
    }
    await files.put(started.upload.url.replace('https://files.counterparty.test/', ''), 10)
    await ok(admin({ method: 'POST', path: `/cards/${card.id}/attachments/${started.id}/complete` }))
    const path = `/cards/${card.id}/attachments/${started.id}`

    expect((await as('rui@uselets.com')({ method: 'POST', path: `/cards/${card.id}/attachments`, body })).status).toBe(
      403
    )
    expect((await as('ana@uselets.com')({ method: 'DELETE', path })).status).toBe(403)
    expect(((await ok(admin({ method: 'DELETE', path }))) as { items: [] }).items).toEqual([])
    expect(files.sizes.size).toBe(0)
  })
})

describe('moving a card to another space', () => {
  it('takes the next number there, and the old key still opens it', async () => {
    await createCard(tec, 'Já existente')
    const card = await createCard(prd, 'Na verdade é técnico')

    const moved = (await ok(
      admin({ method: 'POST', path: `/cards/${card.id}/transfer`, body: { spaceId: tec.id } })
    )) as Card
    const byOldKey = (await ok(admin({ method: 'GET', path: '/cards/by-key/PRD-1' }))) as Card

    expect(moved).toMatchObject({ key: 'TEC-2', spaceId: tec.id })
    expect(byOldKey.key).toBe('TEC-2')
    expect((await history(card)).at(-1)).toMatchObject({
      action: 'transferred',
      changes: { key: { before: 'PRD-1', after: 'TEC-2' } }
    })
  })

  it('needs write in both spaces and refuses a card that has subtasks', async () => {
    const ana = await giveRole('ana@uselets.com', 'member', prd)
    await admin({ method: 'PUT', path: `/spaces/${tec.id}/members/${ana}`, body: { role: 'reader' } })
    const parent = await createCard(prd, 'Pai')
    await createCard(prd, 'Filho', { parentId: parent.id })
    const lone = await createCard(prd, 'Sozinho')

    expect(
      (await admin({ method: 'POST', path: `/cards/${parent.id}/transfer`, body: { spaceId: tec.id } })).status
    ).toBe(409)
    const refused = await as('ana@uselets.com')({
      method: 'POST',
      path: `/cards/${lone.id}/transfer`,
      body: { spaceId: tec.id }
    })
    expect(refused.status).toBe(403)
  })
})

describe('backlog', () => {
  it('orders the open cards by hand, apart from the board order', async () => {
    const [a, b, c] = [await createCard(prd, 'A'), await createCard(prd, 'B'), await createCard(prd, 'C')]

    await ok(admin({ method: 'POST', path: `/cards/${c.id}/backlog`, body: { index: 0 } }))
    await ok(admin({ method: 'POST', path: `/cards/${a.id}/backlog`, body: { index: 1 } }))
    const cards = (
      (await ok(admin({ method: 'GET', path: `/spaces/${prd.id}/cards` }))) as {
        items: (Card & { title: string; backlogRank: number })[]
      }
    ).items

    const order = [...cards].sort((x, y) => x.backlogRank - y.backlogRank).map((card) => card.title)
    expect(order).toEqual(['C', 'A', 'B'])
    expect(b.id).toBeDefined()
  })
})
