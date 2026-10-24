import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { and, eq } from 'drizzle-orm'

import { buildService } from '../container.js'
import { RecordingBroadcaster } from '../draw/broadcaster.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { auditEvents } from '../schema.js'

/**
 * LET’S Wiki (ADR-0033, docs/produto/wiki.md): collections apart from Draw's spaces, pages with an
 * owner, made official by the collection's owners, and reviewed before their date passes.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const DAY = 24 * 60 * 60 * 1000

type Collection = { id: string; name: string; reviewDays: number; outline: string | null; canManage: boolean }
type Content = { id: string; title: string; contentJson: Record<string, unknown> }
type WikiPage = {
  owner: { id: string; name: string }
  state: string
  reviewDue: string | null
  overdue: boolean
  canManage: boolean
  canReview: boolean
}

let service: ReturnType<typeof buildService>
let clock: ReturnType<typeof fixedClock>
let files: InMemoryFileStore
let clientes: Collection

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const invite = async (email: string) =>
  ((await ok(admin({ method: 'POST', path: '/members', body: { email, name: email } }), 201)) as { id: string }).id

const createPage = async (title: string, collection = clientes, who = admin) =>
  (await ok(who({ method: 'POST', path: `/wiki/collections/${collection.id}/pages`, body: { title } }), 201)) as Content

const page = async (id: string, who = admin) =>
  (await ok(who({ method: 'GET', path: `/wiki/pages/${id}` }))) as WikiPage

const official = async (id: string, value = true, who = admin) =>
  (await ok(who({ method: 'PUT', path: `/wiki/pages/${id}/official`, body: { official: value } }))) as WikiPage

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-24T12:00:00.000Z'))
  files = new InMemoryFileStore()
  service = buildService(config, { db, clock, files, broadcaster: new RecordingBroadcaster() })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  clientes = (await ok(
    admin({ method: 'POST', path: '/wiki/collections', body: { name: 'Clientes', outline: 'customer' } }),
    201
  )) as Collection
})

describe('collections', () => {
  it('only an organization admin creates one; everyone reads it; Draw never lists it', async () => {
    await invite('rui@uselets.com')
    const rui = as('rui@uselets.com')
    expect((await rui({ method: 'POST', path: '/wiki/collections', body: { name: 'X' } })).status).toBe(403)
    expect(clientes).toMatchObject({ reviewDays: 90, outline: 'customer', canManage: true })

    const seen = (await ok(rui({ method: 'GET', path: '/wiki/collections' }))) as { items: Collection[] }
    expect(seen.items.map((each) => [each.name, each.canManage])).toEqual([['Clientes', false]])
    const draw = (await ok(rui({ method: 'GET', path: '/draw/spaces' }))) as { items: unknown[] }
    expect(draw.items).toEqual([])
  })

  it('a Draw space is not a collection', async () => {
    const produto = (await ok(admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } }), 201)) as {
      id: string
    }
    expect((await admin({ method: 'GET', path: `/wiki/collections/${produto.id}` })).status).toBe(404)
    expect((await admin({ method: 'POST', path: `/wiki/collections/${produto.id}/pages`, body: {} })).status).toBe(404)
  })

  it('its owners change its review period; a reader cannot', async () => {
    await invite('rui@uselets.com')
    const path = `/wiki/collections/${clientes.id}`
    expect((await as('rui@uselets.com')({ method: 'PATCH', path, body: { reviewDays: 30 } })).status).toBe(403)
    expect(((await ok(admin({ method: 'PATCH', path, body: { reviewDays: 180 } }))) as Collection).reviewDays).toBe(180)
    expect((await admin({ method: 'PATCH', path, body: { reviewDays: 7 } })).status).toBe(400)
  })
})

describe('pages', () => {
  it('a customer page starts from the outline, as a draft its creator owns', async () => {
    const loja = await createPage('Loja Exemplo')
    expect(JSON.stringify(loja.contentJson)).toContain('Combinados')
    expect(JSON.stringify(loja.contentJson)).toContain('Sem telefone')
    expect(await page(loja.id)).toMatchObject({ owner: { name: 'Admin' }, state: 'draft', reviewDue: null })

    const geral = (await ok(
      admin({ method: 'POST', path: '/wiki/collections', body: { name: 'Empresa' } }),
      201
    )) as Collection
    expect(JSON.stringify((await createPage('Missão', geral)).contentJson)).not.toContain('Combinados')
  })

  it('owners make a page official, which starts its review period; a reader cannot', async () => {
    await invite('rui@uselets.com')
    const loja = await createPage('Loja Exemplo')
    const refused = await as('rui@uselets.com')({
      method: 'PUT',
      path: `/wiki/pages/${loja.id}/official`,
      body: { official: true }
    })
    expect(refused.status).toBe(403)

    expect(await official(loja.id)).toMatchObject({ state: 'official', reviewDue: '2027-01-22T12:00:00.000Z' })
    expect(await official(loja.id, false)).toMatchObject({ state: 'draft', reviewDue: null })
  })

  it('past its date it stays official and says so; its owner sees it under reviews and confirms it', async () => {
    const ana = await invite('ana@uselets.com')
    const loja = await createPage('Loja Exemplo')
    await official(loja.id)
    await ok(admin({ method: 'PUT', path: `/wiki/pages/${loja.id}/owner`, body: { ownerId: ana } }))
    clock.advance(91 * DAY)

    const anaCalls = as('ana@uselets.com')
    expect(await page(loja.id, anaCalls)).toMatchObject({ state: 'official', overdue: true, canReview: true })
    const due = (await ok(anaCalls({ method: 'GET', path: '/wiki/reviews' }))) as { items: { title: string }[] }
    expect(due.items).toMatchObject([{ title: 'Loja Exemplo', overdue: true }])

    const reviewed = (await ok(anaCalls({ method: 'POST', path: `/wiki/pages/${loja.id}/review` }))) as WikiPage
    expect(reviewed).toMatchObject({ overdue: false, reviewDue: '2027-04-23T12:00:00.000Z' })
    expect(((await ok(anaCalls({ method: 'GET', path: '/wiki/reviews' }))) as { items: unknown[] }).items).toEqual([])
  })

  it('only the owner or a collection owner reviews or hands a page on; a draft is not reviewed', async () => {
    const ana = await invite('ana@uselets.com')
    await invite('rui@uselets.com')
    const loja = await createPage('Loja Exemplo')
    expect((await admin({ method: 'POST', path: `/wiki/pages/${loja.id}/review` })).status).toBe(409)
    await official(loja.id)

    const rui = as('rui@uselets.com')
    expect((await rui({ method: 'POST', path: `/wiki/pages/${loja.id}/review` })).status).toBe(403)
    expect((await rui({ method: 'PUT', path: `/wiki/pages/${loja.id}/owner`, body: { ownerId: ana } })).status).toBe(
      403
    )
    const stranger = '00000000-0000-4000-8000-000000000000'
    const refused = await admin({ method: 'PUT', path: `/wiki/pages/${loja.id}/owner`, body: { ownerId: stranger } })
    expect(refused.status).toBe(400)
  })

  it('the tree marks each page; the home lists wiki pages and Draw’s home does not', async () => {
    const loja = await createPage('Loja Exemplo')
    await createPage('Outra Loja')
    await official(loja.id)

    const tree = (await ok(admin({ method: 'GET', path: `/wiki/collections/${clientes.id}/pages` }))) as {
      items: { title: string; state: string }[]
    }
    expect(tree.items.map((each) => [each.title, each.state])).toEqual([
      ['Loja Exemplo', 'official'],
      ['Outra Loja', 'draft']
    ])
    const recent = (await ok(admin({ method: 'GET', path: '/wiki/pages/recent' }))) as { items: unknown[] }
    expect(recent.items).toHaveLength(2)
    expect(((await ok(admin({ method: 'GET', path: '/draw/contents' }))) as { items: unknown[] }).items).toEqual([])
  })

  it('every change of state, owner and review is audited', async () => {
    const loja = await createPage('Loja Exemplo')
    await official(loja.id)
    await ok(admin({ method: 'POST', path: `/wiki/pages/${loja.id}/review` }))
    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'wiki_page'), eq(auditEvents.entityId, loja.id)))
    expect(events.map((each) => each.action).sort()).toEqual(['made_official', 'reviewed'])
  })
})

describe('publishing a Draw page', () => {
  const drawPage = async () => {
    const produto = (await ok(admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } }), 201)) as {
      id: string
    }
    const page = (await ok(
      admin({ method: 'POST', path: `/draw/spaces/${produto.id}/contents`, body: { title: 'Política de reembolso' } }),
      201
    )) as Content
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Até 7 dias.' }] }] }
    await ok(admin({ method: 'PUT', path: `/draw/contents/${page.id}/derived`, body: { json, text: 'Até 7 dias.' } }))
    return page
  }
  const publish = (contentId: string, who = admin, collection = clientes) =>
    who({ method: 'POST', path: `/wiki/collections/${collection.id}/published`, body: { contentId } })

  it('copies it into the collection as a draft its publisher owns; the Draw page stays', async () => {
    const source = await drawPage()
    const copy = (await ok(publish(source.id), 201)) as Content
    expect(copy).toMatchObject({ title: 'Política de reembolso' })
    expect(JSON.stringify(copy.contentJson)).toContain('Até 7 dias.')
    expect(await page(copy.id)).toMatchObject({ state: 'draft', owner: { name: 'Admin' } })
    expect((await admin({ method: 'GET', path: `/draw/contents/${source.id}` })).status).toBe(200)
  })

  it('the copy still shows the images and files of the Draw page', async () => {
    const source = await drawPage()
    const started = (await ok(
      admin({
        method: 'POST',
        path: `/draw/contents/${source.id}/files`,
        body: { name: 'fluxo.png', contentType: 'image/png', size: 2048 }
      }),
      201
    )) as { id: string; upload: { url: string } }
    await files.put(new URL(started.upload.url).pathname.slice(1), 2048)
    await ok(admin({ method: 'POST', path: `/draw/contents/${source.id}/files/${started.id}/complete` }))

    const copy = (await ok(publish(source.id), 201)) as Content
    const file = (await ok(admin({ method: 'GET', path: `/draw/contents/${copy.id}/files/${started.id}` }))) as {
      name: string
    }
    expect(file.name).toBe('fluxo.png')
    const loja = await createPage('Loja Exemplo')
    expect((await admin({ method: 'GET', path: `/draw/contents/${loja.id}/files/${started.id}` })).status).toBe(404)
  })

  it('refuses a wiki page as the source, and whoever does not edit the collection', async () => {
    const loja = await createPage('Loja Exemplo')
    expect((await publish(loja.id)).status).toBe(409)
    await invite('rui@uselets.com')
    expect((await publish((await drawPage()).id, as('rui@uselets.com'))).status).toBe(403)
  })
})
