import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { eq, sql } from 'drizzle-orm'
import * as Y from 'yjs'

import { buildService } from '../container.js'
import { RecordingBroadcaster } from '../draw/broadcaster.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { contents } from '../schema.js'

/**
 * LET’S Draw AI (escopo-mvp 5.1–5.7, ADR-0009–0011): its own spaces, a tree of folders, pages and
 * whiteboards, documents two people edit at once, versions restored, comments, files and the relay.
 * Etapa 4 is done when two people edit the same page at the same time without losing anything, and an
 * old version is restored (prompt-construcao.md).
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Content = {
  id: string
  kind: string
  title: string
  parentId: string | null
  contentJson: Record<string, unknown>
}
type Space = { id: string; name: string; starred: boolean; following: boolean; canManage: boolean }
type Tree = { items: { id: string; title: string; kind: string; parentId: string | null }[] }

let service: ReturnType<typeof buildService>
let clock: ReturnType<typeof fixedClock>
let broadcaster: RecordingBroadcaster
let files: InMemoryFileStore
let produto: Space

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

/** A member of the organization, with no role anywhere: they read every space, and edit none (ADR-0012). */
const invite = async (email: string) =>
  ((await ok(admin({ method: 'POST', path: '/members', body: { email, name: email } }), 201)) as { id: string }).id

/** A member who edits Produto: an admin of it gave them the member role. */
const editor = async (email: string) => {
  const id = await invite(email)
  await ok(admin({ method: 'PUT', path: `/draw/spaces/${produto.id}/members/${id}`, body: { role: 'member' } }))
  return id
}

const createSpace = async (name: string, who = admin) =>
  (await ok(who({ method: 'POST', path: '/draw/spaces', body: { name } }), 201)) as Space

const create = async (title: string, extra: Record<string, unknown> = {}, who = admin) =>
  (await ok(
    who({ method: 'POST', path: `/draw/spaces/${produto.id}/contents`, body: { title, ...extra } }),
    201
  )) as Content

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/** A browser's copy of the page: a Y.Doc that sends each of its changes, as the editor does. */
const browser = (content: Content, who = admin) => {
  const doc = new Y.Doc()
  const sent: Promise<unknown>[] = []
  const path = `/draw/contents/${content.id}/document`
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'server') {
      sent.push(ok(who({ method: 'POST', path, body: { update: base64(update) } })))
    }
  })
  const load = async () => {
    const { state } = (await ok(who({ method: 'GET', path }))) as { state: string }
    if (state) {
      Y.applyUpdate(doc, Buffer.from(state, 'base64'), 'server')
    }
  }
  return { doc, load, flush: async () => await Promise.all(sent) }
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-16T12:00:00.000Z'))
  broadcaster = new RecordingBroadcaster()
  files = new InMemoryFileStore()
  service = buildService(config, { db, clock, files, broadcaster })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  produto = await createSpace('Produto')
})

describe('spaces', () => {
  it('a space manager creates one and holds it; everyone sees it; only its admins change it', async () => {
    const ana = await invite('ana@uselets.com')
    await invite('rui@uselets.com')
    const refused = await as('rui@uselets.com')({ method: 'POST', path: '/draw/spaces', body: { name: 'X' } })
    expect(refused.status).toBe(403)
    await ok(admin({ method: 'POST', path: `/members/${ana}/space-manager`, body: { isSpaceManager: true } }))
    const juridico = await createSpace('Jurídico', as('ana@uselets.com'))
    const path = `/draw/spaces/${juridico.id}`

    const seen = (await ok(as('rui@uselets.com')({ method: 'GET', path: '/draw/spaces' }))) as { items: Space[] }
    expect(seen.items.map((each) => each.name).sort()).toEqual(['Jurídico', 'Produto'])
    expect((await as('rui@uselets.com')({ method: 'PATCH', path, body: { name: 'X' } })).status).toBe(403)
    expect(
      ((await ok(as('ana@uselets.com')({ method: 'PATCH', path, body: { name: 'Jurídico LET’S' } }))) as Space).name
    ).toBe('Jurídico LET’S')
    expect(((await ok(admin({ method: 'GET', path }))) as Space).canManage).toBe(true)
  })

  it('stars and follows are each member’s own; starred spaces lead the list', async () => {
    await createSpace('Atas')
    await ok(admin({ method: 'PUT', path: `/draw/spaces/${produto.id}/marks/star` }))
    const followed = (await ok(admin({ method: 'PUT', path: `/draw/spaces/${produto.id}/marks/follow` }))) as Space
    await invite('ana@uselets.com')

    const mine = (await ok(admin({ method: 'GET', path: '/draw/spaces' }))) as { items: Space[] }
    const hers = (await ok(as('ana@uselets.com')({ method: 'GET', path: '/draw/spaces' }))) as { items: Space[] }
    expect(followed).toMatchObject({ starred: true, following: true })
    expect(mine.items.map((each) => each.name)).toEqual(['Produto', 'Atas'])
    expect(hers.items.every((each) => !each.starred)).toBe(true)
  })

  it('deleting a space hides it and what is in it', async () => {
    const page = await create('Spec')
    await ok(admin({ method: 'DELETE', path: `/draw/spaces/${produto.id}` }))
    expect((await admin({ method: 'GET', path: `/draw/contents/${page.id}` })).status).toBe(404)
  })
})

describe('the content tree', () => {
  it('holds folders, pages and whiteboards; nests, reorders and refuses a cycle', async () => {
    const novo = await create('02. Novo', { kind: 'folder' })
    const processos = await create('01. Processos', { kind: 'folder', parentId: novo.id })
    const meetings = await create('04. Meetings', { kind: 'folder', parentId: novo.id })
    await create('Esteira', { parentId: processos.id })
    await create('Mapa da jornada', { kind: 'whiteboard', parentId: processos.id })

    const reordered = (await ok(
      admin({ method: 'POST', path: `/draw/contents/${meetings.id}/move`, body: { parentId: novo.id, index: 0 } })
    )) as Tree
    expect(reordered.items.filter((each) => each.parentId === novo.id).map((each) => each.title)).toEqual([
      '04. Meetings',
      '01. Processos'
    ])
    expect(reordered.items.find((each) => each.title === 'Mapa da jornada')?.kind).toBe('whiteboard')
    const cycle = await admin({
      method: 'POST',
      path: `/draw/contents/${novo.id}/move`,
      body: { parentId: processos.id, index: 0 }
    })
    expect(cycle.status).toBe(409)
    expect((await admin({ method: 'DELETE', path: `/draw/contents/${novo.id}` })).status).toBe(409)
  })

  it('refuses content under a whiteboard, a document on a folder, and a draft in a folder', async () => {
    const board = await create('Quadro', { kind: 'whiteboard' })
    const folder = await create('Pasta', { kind: 'folder' })
    const under = await admin({
      method: 'POST',
      path: `/draw/spaces/${produto.id}/contents`,
      body: { title: 'X', parentId: board.id }
    })
    const drafted = await admin({
      method: 'POST',
      path: `/draw/spaces/${produto.id}/contents`,
      body: { title: 'X', kind: 'folder', draft: { json: {}, text: '' } }
    })

    expect(under.status).toBe(400)
    expect(drafted.status).toBe(400)
    expect((await admin({ method: 'GET', path: `/draw/contents/${folder.id}/document` })).status).toBe(409)
  })

  it('starts a page from a draft — what a prompt produced — as its first content', async () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rascunho' }] }] }
    const page = await create('Do prompt', { draft: { json, text: 'Rascunho' } })
    expect(page.contentJson).toEqual(json)
  })
})

describe('editing together', () => {
  it('two people typing at once both keep what they wrote', async () => {
    await editor('ana@uselets.com')
    const page = await create('Ata')
    const mine = browser(page)
    const hers = browser(page, as('ana@uselets.com'))
    await Promise.all([mine.load(), hers.load()])

    mine.doc.getText('body').insert(0, 'Decisões: ')
    hers.doc.getText('body').insert(0, 'Presentes: Ana. ')
    await Promise.all([mine.flush(), hers.flush()])

    const fresh = browser(page)
    await fresh.load()
    const text = fresh.doc.getText('body').toString()
    expect(text).toContain('Decisões: ')
    expect(text).toContain('Presentes: Ana. ')
  })

  it('folds stored updates into the document and still answers with every change', async () => {
    const page = await create('Longa')
    const writer = browser(page)
    for (let index = 0; index < 60; index += 1) {
      writer.doc.getText('body').insert(index, 'x')
      await writer.flush()
    }
    const fresh = browser(page)
    await fresh.load()
    expect(fresh.doc.getText('body').toString()).toBe('x'.repeat(60))
  })

  it('a whiteboard is a Yjs document too: shapes from two people both stay', async () => {
    await editor('ana@uselets.com')
    const board = await create('Quadro', { kind: 'whiteboard' })
    const mine = browser(board)
    const hers = browser(board, as('ana@uselets.com'))
    mine.doc.getMap('shapes').set('a', { kind: 'note', text: 'Ideia 1' })
    hers.doc.getMap('shapes').set('b', { kind: 'note', text: 'Ideia 2' })
    await Promise.all([mine.flush(), hers.flush()])

    const fresh = browser(board)
    await fresh.load()
    expect([...fresh.doc.getMap('shapes').keys()].sort()).toEqual(['a', 'b'])
  })

  it('a board stored past the Data API’s 1 MiB still lists, opens and shrinks once opened', async () => {
    const board = await create('Jornada', { kind: 'whiteboard' })
    await create('Ao lado')
    // What `Y.mergeUpdates` stored before it collected anything: every step of every drag.
    const writer = new Y.Doc()
    const steps: Uint8Array[] = []
    writer.on('update', (update: Uint8Array) => steps.push(update))
    for (let step = 0; step < 20_000; step += 1) {
      writer.getMap('elements').set('box', { id: 'box', x: step, label: 'Entrega confirmada pelo motorista' })
    }
    const bloated = base64(Y.mergeUpdates(steps))
    expect(bloated.length).toBeGreaterThan(1_048_576)
    await db.update(contents).set({ document: bloated }).where(eq(contents.id, board.id))

    const tree = (await ok(admin({ method: 'GET', path: `/draw/spaces/${produto.id}/contents` }))) as Tree
    expect(tree.items.map((each) => each.title).sort()).toEqual(['Ao lado', 'Jornada'])
    await ok(admin({ method: 'GET', path: '/draw/contents' }))
    await ok(admin({ method: 'PUT', path: `/draw/contents/${board.id}/visit` }), 204)
    await ok(admin({ method: 'GET', path: '/draw/contents/opened' }))
    await ok(admin({ method: 'GET', path: `/draw/contents/${board.id}` }))

    const reader = browser(board)
    await reader.load()
    expect(reader.doc.getMap('elements').get('box')).toMatchObject({ x: 19_999 })
    const [stored] = await db
      .select({ length: sql<number>`length(${contents.document})` })
      .from(contents)
      .where(eq(contents.id, board.id))
    expect(Number(stored?.length)).toBeLessThan(bloated.length / 10)
  }, 30_000)

  it('refuses an update that is not Yjs', async () => {
    const page = await create('Fechada')
    const bad = await admin({
      method: 'POST',
      path: `/draw/contents/${page.id}/document`,
      body: { update: 'bm90LXlqcw==' }
    })
    expect(bad.status).toBe(400)
  })
})

describe('versions', () => {
  const save = (page: Content, text: string, who = admin) =>
    ok(
      who({ method: 'PUT', path: `/draw/contents/${page.id}/derived`, body: { json: { type: 'doc', text }, text } })
    ) as Promise<{ version: number | null }>

  it('takes a version when one is due, and restores an old one as a new version', async () => {
    await editor('ana@uselets.com')
    const page = await create('Spec')

    expect(await save(page, 'Primeira')).toEqual({ version: 1 })
    expect(await save(page, 'Primeira, revista')).toEqual({ version: null })
    expect(await save(page, 'Da Ana', as('ana@uselets.com'))).toEqual({ version: 2 })
    clock.advance(11 * 60_000)
    expect(await save(page, 'Da Ana', as('ana@uselets.com'))).toEqual({ version: null })

    const restored = (await ok(admin({ method: 'POST', path: `/draw/contents/${page.id}/versions/1/restore` }))) as {
      number: number
      reason: string
      restoredFrom: number
      contentText: string
    }
    const after = (await ok(admin({ method: 'GET', path: `/draw/contents/${page.id}` }))) as Content
    const list = (await ok(admin({ method: 'GET', path: `/draw/contents/${page.id}/versions` }))) as {
      items: { number: number }[]
    }

    expect(restored).toMatchObject({ number: 3, reason: 'restore', restoredFrom: 1, contentText: 'Primeira' })
    expect(after.contentJson.text).toBe('Primeira')
    expect(list.items.map((each) => each.number)).toEqual([3, 2, 1])
  })

  it('takes a version on request', async () => {
    const page = await create('Manual')
    const version = (await ok(admin({ method: 'POST', path: `/draw/contents/${page.id}/versions` }), 201)) as {
      number: number
      reason: string
    }
    expect(version).toMatchObject({ number: 1, reason: 'manual', name: null })
  })

  it('names a version saved by hand', async () => {
    const board = await create('Fluxo', { kind: 'whiteboard' })
    const path = `/draw/contents/${board.id}/versions`
    await ok(admin({ method: 'POST', path, body: { name: 'Antes da revisão' } }), 201)
    const list = (await ok(admin({ method: 'GET', path }))) as { items: { name: string | null }[] }
    expect(list.items[0]?.name).toBe('Antes da revisão')
  })
})

describe('opened by me', () => {
  it('lists what each person opened, most recent first, and leaves out what was deleted', async () => {
    const [first, second, gone] = [await create('Primeira'), await create('Segunda'), await create('Apagada')]
    for (const content of [first, gone, second]) {
      clock.advance(60_000)
      await ok(admin({ method: 'PUT', path: `/draw/contents/${content.id}/visit` }), 204)
    }
    clock.advance(60_000)
    await ok(admin({ method: 'PUT', path: `/draw/contents/${first.id}/visit` }), 204)
    await ok(admin({ method: 'DELETE', path: `/draw/contents/${gone.id}` }))

    const opened = (await ok(admin({ method: 'GET', path: '/draw/contents/opened' }))) as { items: { title: string }[] }
    expect(opened.items.map((each) => each.title)).toEqual(['Primeira', 'Segunda'])
    const rui = (await ok(as('rui@uselets.com')({ method: 'GET', path: '/draw/contents/opened' }))) as {
      items: unknown[]
    }
    expect(rui.items).toEqual([])
  })
})

describe('comments', () => {
  it('a member comments on a stretch of text; replies thread under it; anyone resolves it', async () => {
    const rui = await invite('rui@uselets.com')
    const page = await create('Spec')
    const path = `/draw/contents/${page.id}/comments`
    const thread = (await ok(
      as('rui@uselets.com')({
        method: 'POST',
        path,
        body: { body: 'Isso vale para o lojista?', anchorId: 'c1', quote: 'frete grátis' }
      }),
      201
    )) as { items: { id: string }[] }
    const rootId = thread.items[0]?.id ?? ''
    clock.advance(1000)
    await ok(admin({ method: 'POST', path, body: { body: `Sim, <@${rui}>.`, parentId: rootId } }), 201)
    const resolved = (await ok(
      admin({ method: 'POST', path: `${path}/${rootId}/resolve`, body: { resolved: true } })
    )) as {
      items: {
        anchorId: string | null
        quote: string | null
        resolvedAt: string | null
        mentions: { id: string; name: string }[]
      }[]
    }

    expect(resolved.items[0]).toMatchObject({ anchorId: 'c1', quote: 'frete grátis', resolvedAt: expect.any(String) })
    expect(resolved.items[1]?.mentions).toEqual([{ id: rui, name: 'rui@uselets.com' }])
    expect((await admin({ method: 'PATCH', path: `${path}/${rootId}`, body: { body: 'Meu' } })).status).toBe(403)
  })
})

describe('the realtime relay', () => {
  const ticket = async (content: Content, who = admin) =>
    ((await ok(who({ method: 'POST', path: `/draw/contents/${content.id}/realtime` }), 201)) as { ticket: string })
      .ticket

  it('passes a change to the other connections and stores it; a ticket opens one connection', async () => {
    const page = await create('Ao vivo')
    await service.realtime.connect('mine', await ticket(page))
    await service.realtime.connect('yours', await ticket(page))
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'oi')
    const update = base64(Y.encodeStateAsUpdate(doc))

    await service.realtime.receive('mine', JSON.stringify({ type: 'update', update }))

    expect(broadcaster.sent).toEqual([{ connectionId: 'yours', message: { type: 'update', update } }])
    const stored = (await ok(admin({ method: 'GET', path: `/draw/contents/${page.id}/document` }))) as { state: string }
    expect(stored.state.length).toBeGreaterThan(0)
    const used = await ticket(page)
    await service.realtime.connect('third', used)
    expect(service.realtime.connect('fourth', used)).rejects.toThrow('missing, used or expired')
  })

  it('relays a cursor without storing it, and forgets a connection that is gone', async () => {
    const page = await create('Ao vivo')
    await service.realtime.connect('mine', await ticket(page))
    await service.realtime.connect('writer', await ticket(page))
    await service.realtime.connect('closed', await ticket(page))
    broadcaster.gone.add('closed')
    const update = base64(Y.encodeStateAsUpdate(new Y.Doc()))

    await service.realtime.receive('mine', JSON.stringify({ type: 'awareness', update }))
    await service.realtime.receive('mine', JSON.stringify({ type: 'awareness', update }))

    expect(broadcaster.sent.map((each) => each.connectionId)).toEqual(['writer', 'writer'])
  })

  it('refuses an expired ticket', async () => {
    const page = await create('Ao vivo')
    const late = await ticket(page)
    clock.advance(61_000)
    expect(service.realtime.connect('late', late)).rejects.toThrow('missing, used or expired')
  })
})

describe('search and the latest content', () => {
  it('finds a page by its title or text, and lists the latest changed first with its space', async () => {
    const page = await create('Esteira de produto')
    await ok(
      admin({
        method: 'PUT',
        path: `/draw/contents/${page.id}/derived`,
        body: { json: {}, text: 'Do insight ao lançamento' }
      })
    )
    clock.advance(60_000)
    await create('Ata da review')
    await create('Pasta', { kind: 'folder' })
    const search = async (q: string) =>
      (
        (await ok(admin({ method: 'GET', path: '/search', query: { q } }))) as {
          contents: { title: string; excerpt: string }[]
        }
      ).contents
    const recent = (await ok(admin({ method: 'GET', path: '/draw/contents' }))) as {
      items: { title: string; spaceName: string }[]
    }

    expect(await search('insight')).toEqual([
      expect.objectContaining({ title: 'Esteira de produto', excerpt: 'Do insight ao lançamento' })
    ])
    expect(recent.items.map((each) => [each.title, each.spaceName])).toEqual([
      ['Ata da review', 'Produto'],
      ['Esteira de produto', 'Produto']
    ])
  })
})

describe('images and files', () => {
  it('uploads one in two steps and reads it by id', async () => {
    const page = await create('Com imagem')
    const started = (await ok(
      admin({
        method: 'POST',
        path: `/draw/contents/${page.id}/files`,
        body: { name: 'fluxo.png', contentType: 'image/png', size: 2048 }
      }),
      201
    )) as { id: string; upload: { url: string } }
    const path = `/draw/contents/${page.id}/files/${started.id}`

    expect((await admin({ method: 'POST', path: `${path}/complete` })).status).toBe(409)
    await files.put(new URL(started.upload.url).pathname.slice(1), 2048)
    const file = (await ok(admin({ method: 'POST', path: `${path}/complete` }))) as { name: string; url: string }

    expect(file).toMatchObject({ name: 'fluxo.png', url: expect.stringContaining('download') })
  })
})
