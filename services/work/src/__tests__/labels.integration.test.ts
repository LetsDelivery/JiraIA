import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { colorOf } from '../labels/label.schemas.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/** A space's labels (ADR-0032): learned from its cards, coloured, renamed, joined and removed. */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Label = { id: string; name: string; color: string; cards: number }

let service: ReturnType<typeof buildService>
let spaceId: string

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const labels = async () =>
  ((await admin({ method: 'GET', path: `/spaces/${spaceId}/labels` })).body as { items: Label[] }).items
const named = async (name: string) => (await labels()).find((label) => label.name === name) as Label
const card = async (title: string, tags: string[]) =>
  (await admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title, labels: tags } })).body as {
    id: string
  }
const tagsOf = async (id: string) =>
  ((await admin({ method: 'GET', path: `/cards/${id}` })).body as { labels: string[] }).labels

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (
    await admin({ method: 'POST', path: '/spaces', body: { key: 'REQ', name: 'Requisições', type: 'business' } })
  ).body as { id: string }
  spaceId = space.id
})

describe('labels', () => {
  it('learns each label a card gets, in the colour its name gives, and counts the cards', async () => {
    await card('Relatório', ['financeiro', 'okr'])
    const other = await card('Exportar', [])
    await admin({ method: 'PATCH', path: `/cards/${other.id}`, body: { labels: ['okr'] } })

    expect(await labels()).toMatchObject([
      { name: 'financeiro', color: colorOf('financeiro'), cards: 1 },
      { name: 'okr', color: colorOf('okr'), cards: 2 }
    ])
  })

  it('creates a label before any card has it, and colours it', async () => {
    const created = await admin({ method: 'POST', path: `/spaces/${spaceId}/labels`, body: { name: 'cs prioritário' } })
    expect(created.status).toBe(201)
    const label = await named('cs prioritário')
    await admin({ method: 'PATCH', path: `/spaces/${spaceId}/labels/${label.id}`, body: { color: 'teal' } })

    expect(await named('cs prioritário')).toMatchObject({ color: 'teal', cards: 0 })
    expect(
      (await admin({ method: 'POST', path: `/spaces/${spaceId}/labels`, body: { name: 'cs prioritário' } })).status
    ).toBe(409)
  })

  it('renames a label on every card, and records it in each card history', async () => {
    const one = await card('Um', ['fin', 'okr'])
    await admin({
      method: 'PATCH',
      path: `/spaces/${spaceId}/labels/${(await named('fin')).id}`,
      body: { name: 'financeiro' }
    })

    expect(await tagsOf(one.id)).toEqual(['financeiro', 'okr'])
    const history = (await admin({ method: 'GET', path: `/cards/${one.id}/history` })).body as {
      items: { changes: Record<string, unknown> }[]
    }
    expect(history.items.at(-1)?.changes).toEqual({ labels: { before: ['fin', 'okr'], after: ['financeiro', 'okr'] } })
    expect((await labels()).map((label) => label.name)).toEqual(['financeiro', 'okr'])
  })

  it('joins two labels when the new name is taken, keeping each label once per card', async () => {
    const both = await card('Ambas', ['fin', 'financeiro'])
    const only = await card('Só fin', ['fin'])
    await admin({
      method: 'PATCH',
      path: `/spaces/${spaceId}/labels/${(await named('fin')).id}`,
      body: { name: 'financeiro' }
    })

    expect(await tagsOf(both.id)).toEqual(['financeiro'])
    expect(await tagsOf(only.id)).toEqual(['financeiro'])
    expect(await labels()).toMatchObject([{ name: 'financeiro', cards: 2 }])
  })

  it('removes a label from every card, and leaves the catalogue to the space admins', async () => {
    const one = await card('Um', ['okr', 'fin'])
    const removed = await admin({ method: 'DELETE', path: `/spaces/${spaceId}/labels/${(await named('okr')).id}` })

    expect(removed.status).toBe(200)
    expect(await tagsOf(one.id)).toEqual(['fin'])
    expect((await labels()).map((label) => label.name)).toEqual(['fin'])

    const member = (await admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }))
      .body as { id: string }
    await admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role: 'member' } })
    const refused = await as('ana@uselets.com')({
      method: 'POST',
      path: `/spaces/${spaceId}/labels`,
      body: { name: 'x' }
    })
    expect(refused.status).toBe(403)
    expect((await as('ana@uselets.com')({ method: 'GET', path: `/spaces/${spaceId}/labels` })).status).toBe(200)
  })
})
