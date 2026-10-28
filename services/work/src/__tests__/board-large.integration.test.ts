import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { eq } from 'drizzle-orm'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { cards, sprints } from '../schema.js'

/**
 * A space as big as TEC after the migration: thousands of cards whose descriptions together pass the
 * Data API's 1 MiB answer, which the local database refuses the same way (ADR-0027). The board still
 * opens, and a card still opens with its description.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const CARDS = 600
const LONG = 'Contexto, problema e critérios de aceite. '.repeat(75)

let service: ReturnType<typeof buildService>
let spaceId: string
let firstId: string

const admin = async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims('admin@uselets.com') })))

type Listed = { items: { id: string; number: number; description: string }[] }

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  spaceId = (
    (await admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery Board', type: 'software' } }))
      .body as { id: string }
  ).id
  firstId = (
    (await admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title: 'Primeiro' } })).body as {
      id: string
    }
  ).id
  const [first] = await db.select().from(cards).where(eq(cards.id, firstId))
  const copies = Array.from({ length: CARDS - 1 }, (_, index) => ({
    ...(first as typeof cards.$inferSelect),
    id: uuidGenerator.next(),
    number: index + 2,
    title: `Card ${index + 2}`,
    description: LONG,
    rank: index + 2
  }))
  for (let start = 0; start < copies.length; start += 100) {
    await db.insert(cards).values(copies.slice(start, start + 100))
  }
})

describe('a large space', () => {
  it('lists every card in board order, without descriptions, under the 1 MiB answer', async () => {
    const { status, body } = await admin({ method: 'GET', path: `/spaces/${spaceId}/cards` })
    const listed = body as Listed

    expect(status).toBe(200)
    expect(listed.items).toHaveLength(CARDS)
    expect(listed.items.slice(0, 3).map((card) => card.number)).toEqual([1, 2, 3])
    expect(listed.items.every((card) => card.description === '')).toBe(true)
  })

  it('still opens a card with its description', async () => {
    const [card] = await db.select().from(cards).where(eq(cards.number, 2))
    const { body } = await admin({ method: 'GET', path: `/cards/${card?.id}` })

    expect((body as { description: string }).description).toBe(LONG)
  })

  it('reads only the active sprint’s cards from the database when the board asks for them', async () => {
    const [one] = await db.select().from(cards).where(eq(cards.number, 7))
    const sprintId = uuidGenerator.next()
    await db.insert(sprints).values({
      id: sprintId,
      organizationId: String(one?.organizationId),
      spaceId,
      number: 18,
      name: 'Sprint 18',
      state: 'active',
      startsOn: '2026-10-26',
      endsOn: '2026-11-13',
      createdAt: systemClock.now()
    })
    await db
      .update(cards)
      .set({ sprintId })
      .where(eq(cards.id, String(one?.id)))

    const active = (await admin({ method: 'GET', path: `/spaces/${spaceId}/cards`, query: { sprint: 'active' } }))
      .body as Listed
    const none = (await admin({ method: 'GET', path: `/spaces/${spaceId}/cards`, query: { sprint: 'none' } }))
      .body as Listed

    expect(active.items.map((card) => card.number)).toEqual([7])
    expect(none.items).toHaveLength(CARDS - 1)
  })
})
