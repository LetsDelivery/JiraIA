import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { RecordingBroadcaster } from '../draw/broadcaster.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * LET’S Wiki's closed collections (ADR-0034): a restricted collection is read only by who holds a role,
 * a personal one by its member and whoever they invite — and whoever cannot read one never learns it
 * exists: not in a list, a search, a notice or an address.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Collection = {
  id: string
  name: string
  access: string
  owners: { name: string }[]
  stats: { pages: number; official: number; overdue: number; people: number }
}
type Content = { id: string; title: string }
type Lines = { items: { title: string }[] }

let service: ReturnType<typeof buildService>
let clock: ReturnType<typeof fixedClock>
let comercial: Collection
let proposta: Content
const people: Record<string, string> = {}

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')
const rui = as('rui@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const invite = async (email: string, name: string) => {
  const member = (await ok(admin({ method: 'POST', path: '/members', body: { email, name } }), 201)) as { id: string }
  people[email] = member.id
  await as(email)({ method: 'GET', path: '/me' })
}

const grant = async (collectionId: string, email: string, role: string, who = admin) =>
  await ok(who({ method: 'PUT', path: `/draw/spaces/${collectionId}/members/${people[email]}`, body: { role } }))

const titles = async (who: ReturnType<typeof as>, path: string, query?: Record<string, string>) =>
  ((await ok(who({ method: 'GET', path, ...(query ? { query } : {}) }))) as Lines).items.map((each) => each.title)

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-25T12:00:00.000Z'))
  service = buildService(config, {
    db,
    clock,
    files: new InMemoryFileStore(),
    broadcaster: new RecordingBroadcaster()
  })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  await invite('ana@uselets.com', 'Ana')
  await invite('rui@uselets.com', 'Rui')
  comercial = (await ok(
    admin({ method: 'POST', path: '/wiki/collections', body: { name: 'Comercial', access: 'restricted' } }),
    201
  )) as Collection
  proposta = (await ok(
    admin({ method: 'POST', path: `/wiki/collections/${comercial.id}/pages`, body: { title: 'Tabela negociada' } }),
    201
  )) as Content
})

describe('a restricted collection', () => {
  it('is not there for whoever holds no role: no list, address, page, tree or search', async () => {
    expect(((await ok(rui({ method: 'GET', path: '/wiki/collections' }))) as { items: unknown[] }).items).toEqual([])
    expect((await rui({ method: 'GET', path: `/wiki/collections/${comercial.id}` })).status).toBe(404)
    expect((await rui({ method: 'GET', path: `/wiki/collections/${comercial.id}/pages` })).status).toBe(404)
    expect((await rui({ method: 'GET', path: `/wiki/pages/${proposta.id}` })).status).toBe(404)
    expect((await rui({ method: 'GET', path: `/draw/contents/${proposta.id}` })).status).toBe(404)
    expect((await rui({ method: 'GET', path: `/draw/spaces/${comercial.id}/grants` })).status).toBe(404)
    expect(await titles(rui, '/wiki/pages/recent')).toEqual([])
    const found = (await ok(rui({ method: 'GET', path: '/search', query: { q: 'Tabela' } }))) as {
      contents: unknown[]
    }
    expect(found.contents).toEqual([])
  })

  it('opens to a reader, who reads but does not write', async () => {
    await grant(comercial.id, 'rui@uselets.com', 'reader')
    expect(await titles(rui, '/wiki/pages/recent')).toEqual(['Tabela negociada'])
    const refused = await rui({ method: 'POST', path: `/wiki/collections/${comercial.id}/pages`, body: { title: 'X' } })
    expect(refused.status).toBe(403)
    const found = (await ok(rui({ method: 'GET', path: '/search', query: { q: 'Tabela' } }))) as {
      contents: { area: string }[]
    }
    expect(found.contents).toMatchObject([{ area: 'wiki' }])
  })

  it('stops a mention reaching whoever cannot read it', async () => {
    await grant(comercial.id, 'ana@uselets.com', 'member')
    const body = { body: `<@${people['rui@uselets.com']}> <@${people['ana@uselets.com']}> confere?` }
    await ok(admin({ method: 'POST', path: `/draw/contents/${proposta.id}/comments`, body }), 201)
    await service.drain()
    const inbox = (who: ReturnType<typeof as>) => ok(who({ method: 'GET', path: '/me/notifications' }))
    expect(((await inbox(rui)) as { items: unknown[] }).items).toEqual([])
    expect(((await inbox(ana)) as { items: unknown[] }).items).toHaveLength(1)
  })

  it('its owners open it to everyone, and it lists its owners and counts', async () => {
    await grant(comercial.id, 'ana@uselets.com', 'member')
    await ok(admin({ method: 'PUT', path: `/wiki/pages/${proposta.id}/official`, body: { official: true } }))
    const opened = (await ok(
      admin({ method: 'PATCH', path: `/wiki/collections/${comercial.id}`, body: { access: 'organization' } })
    )) as Collection
    expect(opened).toMatchObject({
      access: 'organization',
      owners: [{ name: 'Admin' }],
      stats: { pages: 1, official: 1, overdue: 0, people: 2 }
    })
    expect(await titles(rui, '/wiki/pages/recent')).toEqual(['Tabela negociada'])
  })
})

describe('a personal collection', () => {
  const mine = async (who: ReturnType<typeof as>) =>
    (await ok(who({ method: 'GET', path: '/wiki/me/collection' }))) as Collection

  it('is made once for its member, and no one else reads it — not even an organization admin', async () => {
    const first = await mine(ana)
    expect(first).toMatchObject({ access: 'personal', name: 'Privado' })
    expect((await mine(ana)).id).toBe(first.id)
    const page = (await ok(
      ana({ method: 'POST', path: `/wiki/collections/${first.id}/pages`, body: { title: 'Notas' } }),
      201
    )) as Content
    expect((await admin({ method: 'GET', path: `/wiki/pages/${page.id}` })).status).toBe(404)
    expect(
      ((await ok(admin({ method: 'GET', path: '/wiki/collections' }))) as { items: unknown[] }).items
    ).toHaveLength(1)
  })

  it('shows under "Compartilhadas comigo" for whoever its member invites', async () => {
    const first = await mine(ana)
    await ok(ana({ method: 'POST', path: `/wiki/collections/${first.id}/pages`, body: { title: 'Rascunho' } }), 201)
    expect(await titles(rui, '/wiki/shared')).toEqual([])
    await grant(first.id, 'rui@uselets.com', 'member', ana)
    expect(await titles(rui, '/wiki/shared')).toEqual(['Rascunho'])
    expect(await titles(ana, '/wiki/shared')).toEqual([])
  })

  it('keeps its pages drafts: they reach a collection by being published there', async () => {
    const first = await mine(ana)
    const page = (await ok(
      ana({ method: 'POST', path: `/wiki/collections/${first.id}/pages`, body: { title: 'Processo novo' } }),
      201
    )) as Content
    const official = await ana({ method: 'PUT', path: `/wiki/pages/${page.id}/official`, body: { official: true } })
    expect(official.status).toBe(409)
    await grant(comercial.id, 'ana@uselets.com', 'member')
    const copy = (await ok(
      ana({ method: 'POST', path: `/wiki/collections/${comercial.id}/published`, body: { contentId: page.id } }),
      201
    )) as Content
    expect(copy.title).toBe('Processo novo')
    const change = await ana({
      method: 'PATCH',
      path: `/wiki/collections/${first.id}`,
      body: { access: 'organization' }
    })
    expect(change.status).toBe(409)
  })
})

describe('favorites and what was opened', () => {
  it('lists a member’s stars and visits, and drops what they can no longer read', async () => {
    await grant(comercial.id, 'rui@uselets.com', 'reader')
    await ok(rui({ method: 'PUT', path: `/wiki/pages/${proposta.id}/favorite`, body: { favorite: true } }))
    await ok(rui({ method: 'PUT', path: `/draw/contents/${proposta.id}/visit` }), 204)
    expect(await titles(rui, '/wiki/favorites')).toEqual(['Tabela negociada'])
    expect(await titles(rui, '/wiki/pages/opened')).toEqual(['Tabela negociada'])
    expect(
      ((await ok(rui({ method: 'GET', path: `/wiki/pages/${proposta.id}` }))) as { favorite: boolean }).favorite
    ).toBe(true)

    await ok(admin({ method: 'DELETE', path: `/draw/spaces/${comercial.id}/members/${people['rui@uselets.com']}` }))
    expect(await titles(rui, '/wiki/favorites')).toEqual([])
    expect(await titles(rui, '/wiki/pages/opened')).toEqual([])
  })
})

describe('a page’s icon', () => {
  it('is an emoji its editors set or clear', async () => {
    const path = `/draw/contents/${proposta.id}/icon`
    expect(((await ok(admin({ method: 'PUT', path, body: { icon: '💰' } }))) as { icon: string }).icon).toBe('💰')
    const tree = (await ok(admin({ method: 'GET', path: `/wiki/collections/${comercial.id}/pages` }))) as {
      items: { icon: string | null; owner: { name: string } }[]
    }
    expect(tree.items[0]).toMatchObject({ icon: '💰', owner: { name: 'Admin' } })
    expect(((await ok(admin({ method: 'PUT', path, body: { icon: null } }))) as { icon: null }).icon).toBeNull()
  })
})
