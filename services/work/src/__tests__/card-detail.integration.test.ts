import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import type { CardDetail } from '../cards/detail.service.js'
import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/** The opened card's page in one answer, with the same permissions as the separate routes. */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

let service: ReturnType<typeof buildService>
let spaceId: string

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const createCard = async (title: string, extra: Record<string, unknown> = {}) => {
  const created = await admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title, ...extra } })
  expect(created.status).toBe(201)
  return created.body as { id: string; key: string }
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  const clock = fixedClock(new Date('2026-10-15T12:00:00.000Z'))
  service = buildService(config, { db, clock })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (
    await admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery Board', type: 'software' } })
  ).body as { id: string }
  spaceId = space.id
})

describe('GET /cards/{cardId}/detail', () => {
  it('answers the card with its comments, relations, watchers, history and star in one body', async () => {
    const parent = await createCard('Parent')
    const card = await createCard('Child', { parentId: parent.id, description: 'Some text' })
    await admin({ method: 'POST', path: `/cards/${card.id}/comments`, body: { body: 'First words' } })
    await admin({ method: 'PUT', path: `/cards/${card.id}/star` })

    const detail = await admin({ method: 'GET', path: `/cards/${card.id}/detail` })

    expect(detail.status).toBe(200)
    const body = detail.body as CardDetail
    expect(body.card.key).toBe(card.key)
    expect(body.card.description).toBe('Some text')
    expect(body.comments.map((comment) => comment.body)).toEqual(['First words'])
    expect(body.relations.parent?.key).toBe(parent.key)
    expect(body.watchers.map((watcher) => watcher.name)).toContain('Admin')
    expect(body.history.length).toBeGreaterThan(0)
    expect(body.starred).toBe(true)
    expect(body).toMatchObject({ proposals: [], attachments: [], worklogs: [], development: [] })
  })

  it('shows a reader the same card the separate route shows them, starred only for whoever starred it', async () => {
    const card = await createCard('Shared')
    await admin({ method: 'PUT', path: `/cards/${card.id}/star` })
    await admin({ method: 'POST', path: '/members', body: { email: 'bia@uselets.com', name: 'Bia' } })
    const bia = as('bia@uselets.com')

    const detail = await bia({ method: 'GET', path: `/cards/${card.id}/detail` })
    const alone = await bia({ method: 'GET', path: `/cards/${card.id}` })

    expect(detail.status).toBe(200)
    expect((detail.body as CardDetail).card).toEqual(alone.body as CardDetail['card'])
    expect((detail.body as CardDetail).starred).toBe(false)
  })

  it('answers 404 for a card that does not exist', async () => {
    const detail = await admin({ method: 'GET', path: '/cards/00000000-0000-4000-8000-000000000000/detail' })

    expect(detail.status).toBe(404)
  })
})
