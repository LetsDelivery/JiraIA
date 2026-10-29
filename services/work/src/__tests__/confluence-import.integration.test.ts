import { beforeEach, describe, expect, it } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { fixedClock, uuidGenerator } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'
import { answer, apiEvent, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { and, asc, eq } from 'drizzle-orm'

import { buildService } from '../container.js'
import { InMemoryAttachmentFiles } from '../import/attachment-files.js'
import { ConfluenceImport } from '../import/confluence-import.js'
import { versionKey } from '../import/confluence-raw-copy.js'
import { InMemoryImportStore } from '../import/import-store.js'
import type { Person } from '../import/people.js'
import { PEOPLE_MAPPING } from '../import/people-scan.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import {
  auditEvents,
  contentComments,
  contentFiles,
  contents,
  contentVersions,
  drawSpaceMembers,
  drawSpaces,
  members
} from '../schema.js'

/**
 * Etapa 8e: a raw Confluence copy and the site backup's whiteboards become a LET'S Draw space with
 * Confluence's tree, files, versions and comments, by their authors and dates — once (ADR-0036).
 */
const db = await testDatabase('services/work/drizzle')
const clock = fixedClock(new Date('2026-10-29T12:00:00.000Z'))

const ANA = '712020:00000000-0000-4000-8000-00000000000a'
const RAW = 'import/raw1/confluence'
const mapping: Person[] = [
  {
    accountId: ANA,
    name: 'Ana Souza',
    email: 'ana@uselets.com',
    active: true,
    occurrences: 5,
    member: 'ana@uselets.com',
    rule: 'own-email'
  }
]

const adf = (...content: unknown[]) => ({ atlas_doc_format: { value: JSON.stringify({ type: 'doc', content }) } })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const version = (number: number, createdAt: string, message = '') => ({ number, authorId: ANA, createdAt, message })

const home = {
  node: {
    id: 'p1',
    title: 'Regras',
    status: 'current',
    position: 1,
    authorId: ANA,
    createdAt: '2025-11-18T17:23:36.972Z',
    version: version(2, '2025-11-19T10:00:00.000Z'),
    body: adf(
      para(text('Status '), text('ACCEPTED', [{ type: 'annotation', attrs: { id: 'mk-1' } }])),
      para({ type: 'mention', attrs: { id: ANA, text: '@Ana' } }),
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'file-shown', type: 'file' } }] }
    )
  },
  versions: [version(1, '2025-11-18T17:24:13.113Z'), version(2, '2025-11-19T10:00:00.000Z', 'Revisão final')],
  attachments: [
    {
      id: 'att1',
      fileId: 'file-shown',
      title: 'tela.png',
      mediaType: 'image/png',
      fileSize: 191,
      version: version(1, '2025-11-18T17:30:00.000Z')
    },
    {
      id: 'att2',
      fileId: 'file-extra',
      title: 'contrato.pdf',
      mediaType: 'application/pdf',
      fileSize: 900,
      version: version(1, '2025-11-18T17:31:00.000Z')
    }
  ],
  footerComments: [
    {
      id: 'c1',
      body: adf(para(text('Ótima página'))),
      version: version(1, '2025-11-20T09:00:00.000Z'),
      resolutionStatus: 'open',
      replies: [{ id: 'c2', body: adf(para(text('Valeu'))), version: version(1, '2025-11-20T10:00:00.000Z') }]
    }
  ],
  inlineComments: [
    {
      id: 'c3',
      body: adf(para(text('Para COLLECTED.'))),
      version: version(1, '2026-04-28T11:41:59.149Z'),
      resolutionStatus: 'open',
      properties: { inlineMarkerRef: 'mk-1', inlineOriginalSelection: 'ACCEPTED' },
      replies: []
    },
    {
      id: 'c4',
      body: adf(para(text('Já corrigido'))),
      version: version(1, '2026-04-29T08:00:00.000Z'),
      resolutionStatus: 'resolved',
      properties: { inlineMarkerRef: 'mk-2', inlineOriginalSelection: 'antigo' },
      replies: []
    }
  ]
}
const folder = {
  node: {
    id: 'f1',
    title: 'Projetos',
    position: 2,
    authorId: ANA,
    createdAt: '2025-01-01T00:00:00Z',
    version: version(1, '2025-01-01T00:00:00Z')
  }
}
const board = {
  node: {
    id: 'w1',
    title: 'Fluxo',
    position: 1,
    authorId: ANA,
    createdAt: 1721755673407,
    version: version(16, '2026-02-19T11:26:49.191Z')
  }
}
const embed = {
  node: {
    id: 'e1',
    title: 'Slides',
    position: 2,
    authorId: ANA,
    createdAt: 1721755673407,
    embedUrl: 'https://docs.google.com/presentation/d/x',
    version: version(1, '2025-01-01T00:00:00Z')
  }
}
const archived = {
  node: {
    id: 'p2',
    title: 'Antiga',
    status: 'archived',
    position: 3,
    authorId: ANA,
    createdAt: '2024-01-01T00:00:00Z',
    version: version(1, '2024-01-01T00:00:00Z'),
    body: adf(para(text('velha')))
  }
}

const tree = [
  { id: 'p1', type: 'page', parentId: null },
  { id: 'f1', type: 'folder', parentId: null },
  { id: 'p2', type: 'page', parentId: null },
  { id: 'w1', type: 'whiteboard', parentId: 'f1' },
  { id: 'e1', type: 'embed', parentId: 'f1' }
]

const boardDocument = {
  nodes: {
    n1: {
      id: 'n1',
      type: 'sticky',
      geometry: { position: { x: 0, y: 0 }, size: { x: 100, y: 100 } },
      color: 'palette.light.yellow.200',
      text: JSON.stringify({ type: 'doc', content: [para(text('Ideia'))] })
    },
    i1: {
      id: 'i1',
      type: 'image',
      legacyGeometry: { position: { x: 300, y: 0 }, size: { x: 50, y: 50 } },
      fileId: 'board-image'
    },
    pin: { id: 'pin', type: 'comment', commentId: 'x' }
  },
  edges: {}
}
const backupCsv = () =>
  [
    'contentId,documentId,spaceId,documentType,data',
    `w1,doc-1,9,whiteboard,${Buffer.concat([Buffer.from([2]), gzipSync(JSON.stringify(boardDocument))]).toString('base64')}`,
    '000000,1'
  ].join('\n')

let store: InMemoryImportStore
let files: InMemoryAttachmentFiles
let actorId: string
let organizationId: string

const run = (id: string) =>
  new ConfluenceImport({ db, store, files, clock, ids: uuidGenerator, logger: createLogger('work', 'import') }).run({
    organizationId,
    actorId,
    rawRun: 'raw1',
    run: id
  })

const contentOf = async (title: string) => {
  const [row] = await db.select().from(contents).where(eq(contents.title, title))
  return row
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  const admin = await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'stenio@uselets.com', name: 'Stênio' } }
  )
  actorId = admin.id
  organizationId = admin.organizationId
  store = new InMemoryImportStore()
  files = new InMemoryAttachmentFiles()
  await store.putJson(PEOPLE_MAPPING, mapping)
  await store.putJson(`${RAW}/spaces.json`, [
    { id: '9', key: 'BA', name: 'Tech', authorId: ANA, createdAt: '2023-07-14T13:42:09.879Z' }
  ])
  await store.putJson(`${RAW}/BA/tree.json`, tree)
  await store.putJson(`${RAW}/BA/pages/p1.json`, home)
  await store.putJson(`${RAW}/BA/pages/p2.json`, archived)
  await store.putJson(`${RAW}/BA/folders/f1.json`, folder)
  await store.putJson(`${RAW}/BA/whiteboards/w1.json`, board)
  await store.putJson(`${RAW}/BA/embeds/e1.json`, embed)
  await store.putJson(versionKey('p1', 1), { title: 'Regras (rascunho)', body: adf(para(text('primeira'))) })
  await store.putJson(versionKey('p1', 2), { title: 'Regras', body: home.node.body })
  await store.putJson(versionKey('p2', 1), { title: 'Antiga', body: archived.node.body })
  await store.putBytes('import/confluence/whiteboards/whiteboardExport_1.csv', new TextEncoder().encode(backupCsv()))
})

describe('importing Confluence into LET’S Draw', () => {
  it('creates the space by Confluence’s author and date, for every active member to edit', async () => {
    await run('r1')
    const [space] = await db.select().from(drawSpaces)
    expect(space).toMatchObject({ name: 'Tech', icon: '💻', area: 'draw' })
    expect(space?.createdAt.toISOString()).toBe('2023-07-14T13:42:09.879Z')
    const [ana] = await db.select().from(members).where(eq(members.email, 'ana@uselets.com'))
    expect(space?.createdBy).toBe(ana?.id)
    const roles = await db.select().from(drawSpaceMembers)
    expect(new Map(roles.map((row) => [row.memberId, row.role]))).toEqual(
      new Map([
        [actorId, 'admin'],
        [String(ana?.id), 'admin']
      ])
    )
  })

  it('rebuilds the tree in Confluence’s order, archived pages in a folder of their own', async () => {
    await run('r1')
    const rows = await db.select().from(contents).orderBy(asc(contents.position))
    const byId = new Map(rows.map((row) => [row.id, row]))
    const shape = rows.map((row) => [row.title, row.kind, byId.get(row.parentId ?? '')?.title ?? null, row.position])
    expect(shape.sort()).toEqual(
      [
        ['Regras', 'page', null, 1],
        ['Projetos', 'folder', null, 2],
        ['Arquivados', 'folder', null, 3],
        ['Antiga', 'page', 'Arquivados', 1],
        ['Fluxo', 'whiteboard', 'Projetos', 1],
        ['Slides', 'page', 'Projetos', 2]
      ].sort()
    )
  })

  it('opens a page as it was, its files imported, its open inline comment marked', async () => {
    await run('r1')
    const page = await contentOf('Regras')
    const json = JSON.stringify(page?.contentJson)
    expect(json).toContain('"type":"comment"')
    expect(json).toContain('"id":"mk-1"')
    expect(json).toContain('"type":"mention","attrs":{"id"')
    expect(page?.contentText).toContain('@Ana Souza')
    const stored = await db
      .select()
      .from(contentFiles)
      .where(eq(contentFiles.contentId, page?.id ?? ''))
    expect(stored.map((file) => [file.name, file.status, file.size]).sort()).toEqual([
      ['contrato.pdf', 'ready', 900],
      ['tela.png', 'ready', 191]
    ])
    const shown = ((page?.contentJson ?? {}) as { content: { type: string; attrs?: { fileId?: string } }[] }).content
    expect(shown.find((node) => node.type === 'pageImage')?.attrs?.fileId).toBe(
      stored.find((f) => f.name === 'tela.png')?.id
    )
    expect(shown.find((node) => node.type === 'pageFile')?.attrs?.fileId).toBe(
      stored.find((f) => f.name === 'contrato.pdf')?.id
    )
    expect(files.copies).toContainEqual({
      from: 'import/confluence/files/file-shown',
      to: `${organizationId}/contents/${page?.id}/${stored.find((f) => f.name === 'tela.png')?.id}`
    })
  })

  it('keeps every version by number, author and date; a published message names it', async () => {
    await run('r1')
    const page = await contentOf('Regras')
    const versions = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, page?.id ?? ''))
      .orderBy(asc(contentVersions.number))
    expect(versions.map((row) => [row.number, row.title, row.reason, row.name, row.contentText])).toEqual([
      [1, 'Regras (rascunho)', 'auto', null, 'primeira'],
      [2, 'Regras', 'manual', 'Revisão final', expect.stringContaining('ACCEPTED')]
    ])
    expect(versions[0]?.createdAt.toISOString()).toBe('2025-11-18T17:24:13.113Z')
    const boardVersions = await db
      .select({ number: contentVersions.number })
      .from(contentVersions)
      .where(eq(contentVersions.contentId, (await contentOf('Fluxo'))?.id ?? ''))
    expect(boardVersions).toEqual([{ number: 16 }])
  })

  it('keeps threads, replies, inline anchors and what was resolved', async () => {
    await run('r1')
    const rows = await db.select().from(contentComments).orderBy(asc(contentComments.createdAt))
    const [footer, reply, inline, resolved] = rows
    expect(footer).toMatchObject({ body: 'Ótima página', parentId: null, anchorId: null })
    expect(reply).toMatchObject({ body: 'Valeu', parentId: footer?.id })
    expect(inline).toMatchObject({ anchorId: 'mk-1', quote: 'ACCEPTED', resolvedAt: null })
    expect(resolved).toMatchObject({ anchorId: 'mk-2', quote: 'antigo' })
    expect(resolved?.resolvedAt?.toISOString()).toBe('2026-04-29T08:00:00.000Z')
  })

  it('draws the whiteboard from the backup with its image, and opens an embed as its link', async () => {
    const report = await run('r1')
    const whiteboard = await contentOf('Fluxo')
    const { elements } = (whiteboard?.contentJson ?? {}) as { elements: { type: string; fileId?: string }[] }
    expect(elements.map((element) => element.type).sort()).toEqual(['image', 'rectangle', 'text'])
    const [image] = await db
      .select()
      .from(contentFiles)
      .where(eq(contentFiles.contentId, whiteboard?.id ?? ''))
    expect(elements.find((element) => element.type === 'image')?.fileId).toBe(image?.id)
    expect(whiteboard?.contentText).toBe('Ideia')
    expect((await contentOf('Slides'))?.contentText).toContain('https://docs.google.com/presentation/d/x')
    expect(report.spaces[0]?.boardComments).toBe(1)
  })

  it('writes the past already dispatched, so nobody is notified', async () => {
    await run('r1')
    const events = await db.select().from(auditEvents).where(eq(auditEvents.via, 'Confluence'))
    expect(events.length).toBeGreaterThan(10)
    expect(events.every((event) => event.dispatchedAt !== null)).toBe(true)
    const page = await contentOf('Regras')
    const created = events.find((event) => event.action === 'created' && event.entityId === page?.id)
    expect(created?.occurredAt.toISOString()).toBe('2025-11-18T17:23:36.972Z')
  })

  it('writes nothing twice when run again', async () => {
    await run('r1')
    const count = async () => [
      (await db.select().from(contents)).length,
      (await db.select().from(contentVersions)).length,
      (await db.select().from(contentComments)).length,
      (await db.select().from(contentFiles)).length
    ]
    const before = await count()
    const report = await run('r2')
    expect(await count()).toEqual(before)
    expect(report.spaces[0]?.contents).toEqual({ inserted: 0, updated: 0, unchanged: 6 })
  })

  it('names a file the backup has no bytes for, and brings it on a later run', async () => {
    files.absent.add('import/confluence/files/file-extra')
    const first = await run('r1')
    expect(first.spaces[0]?.missingFiles).toEqual(['p1:contrato.pdf'])
    const page = await contentOf('Regras')
    expect(JSON.stringify(page?.contentJson)).not.toContain('pageFile')
    files.absent.clear()
    await run('r2')
    const stored = await db
      .select()
      .from(contentFiles)
      .where(and(eq(contentFiles.contentId, page?.id ?? ''), eq(contentFiles.name, 'contrato.pdf')))
    expect(stored).toHaveLength(1)
    expect(JSON.stringify((await contentOf('Regras'))?.contentJson)).toContain('pageFile')
  })

  it('lists a big imported space without reading its documents', async () => {
    await run('r1')
    const service = buildService(
      {
        DATABASE_URL: 'unused',
        AWS_REGION: 'us-east-1',
        ALLOWED_EMAIL_DOMAINS: ['uselets.com'],
        ATTACHMENTS_BUCKET: 'unused',
        REALTIME_URL: 'ws://localhost/realtime'
      },
      { db }
    )
    const [space] = await db.select().from(drawSpaces)
    const tree = answer(
      await service.router(
        apiEvent({ method: 'GET', path: `/draw/spaces/${space?.id}/contents`, claims: googleClaims('ana@uselets.com') })
      )
    )
    expect(tree.status).toBe(200)
    expect((tree.body as { items: Record<string, unknown>[] }).items).toHaveLength(6)
    expect((tree.body as { items: Record<string, unknown>[] }).items[0]).not.toHaveProperty('contentJson')
  })
})
