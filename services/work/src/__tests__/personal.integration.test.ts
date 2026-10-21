import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import type { MySpaces } from '../personal/schemas.js'

/** Para você and the sidebar: stars, recent visits and recommendations, per member. */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const DAY = 24 * 60 * 60 * 1000

let clock: ReturnType<typeof fixedClock>
let service: ReturnType<typeof buildService>
let adminSubject: string

/** Calls as the person who signed in with Google as `email`. */
const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = () => as(adminSubject)
const mySpaces = async (subject: string) => (await as(subject)({ method: 'GET', path: '/me/spaces' })).body as MySpaces
const names = (spaces: { name: string }[]) => spaces.map((space) => space.name)

/** `Jurídico` → `JUR`: a valid, distinct key per test space. */
const keyOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase()

const createSpace = async (name: string) =>
  (
    (await admin()({ method: 'POST', path: '/spaces', body: { name, key: keyOf(name), type: 'business' } })).body as {
      id: string
    }
  ).id

const open = async (subject: string, spaceId: string, times = 1) => {
  for (let visit = 0; visit < times; visit += 1) {
    expect((await as(subject)({ method: 'GET', path: `/spaces/${spaceId}` })).status).toBe(200)
    clock.advance(1000)
  }
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-15T12:00:00.000Z'))
  service = buildService(config, { db, clock })
  const created = await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  adminSubject = created.email ?? ''
})

describe('GET /me/spaces', () => {
  it('lists recent spaces by the last time they were opened', async () => {
    const produto = await createSpace('Produto')
    const juridico = await createSpace('Jurídico')
    await createSpace('Marketing')

    await open(adminSubject, produto)
    await open(adminSubject, juridico)

    expect(names((await mySpaces(adminSubject)).recent)).toEqual(['Jurídico', 'Produto'])
  })

  it('recommends the most opened in the last 30 days first, then the rest by name, never a starred one', async () => {
    const produto = await createSpace('Produto')
    const juridico = await createSpace('Jurídico')
    const marketing = await createSpace('Marketing')
    await createSpace('Tecnologia')

    await open(adminSubject, juridico, 3)
    await open(adminSubject, produto, 1)
    await admin()({ method: 'PUT', path: `/spaces/${marketing}/star` })

    const spaces = await mySpaces(adminSubject)

    expect(names(spaces.recommended)).toEqual(['Jurídico', 'Produto', 'Tecnologia'])
    expect(names(spaces.starred)).toEqual(['Marketing'])
  })

  it('stops counting visits older than 30 days toward the recommendation', async () => {
    const produto = await createSpace('Produto')
    const juridico = await createSpace('Jurídico')
    await open(adminSubject, produto, 5)
    clock.advance(31 * DAY)
    await open(adminSubject, juridico, 1)

    expect(names((await mySpaces(adminSubject)).recommended)).toEqual(['Jurídico', 'Produto'])
  })

  it('shows a member every space, and only their own stars', async () => {
    const produto = await createSpace('Produto')
    await createSpace('Jurídico')
    await admin()({ method: 'PUT', path: `/spaces/${produto}/star` })
    const ana = (await admin()({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }))
      .body as { id: string }
    await admin()({ method: 'PUT', path: `/spaces/${produto}/members/${ana.id}`, body: { role: 'member' } })
    const anaSubject = 'ana@uselets.com'

    const spaces = await mySpaces(anaSubject)

    expect(spaces.starred).toEqual([])
    expect(names(spaces.recommended).sort()).toEqual(['Jurídico', 'Produto'])
  })
})

describe('stars', () => {
  it('stars and unstars a space, and starring twice is harmless', async () => {
    const produto = await createSpace('Produto')

    expect((await admin()({ method: 'PUT', path: `/spaces/${produto}/star` })).status).toBe(204)
    expect((await admin()({ method: 'PUT', path: `/spaces/${produto}/star` })).status).toBe(204)
    expect((await mySpaces(adminSubject)).starred).toMatchObject([{ id: produto, starred: true }])

    expect((await admin()({ method: 'DELETE', path: `/spaces/${produto}/star` })).status).toBe(204)
    expect((await mySpaces(adminSubject)).starred).toEqual([])
  })

  it('lets a member with no role star a space, and answers 404 for one that does not exist', async () => {
    const produto = await createSpace('Produto')
    await admin()({ method: 'POST', path: '/members', body: { email: 'rui@uselets.com', name: 'Rui' } })
    const rui = as('rui@uselets.com')

    expect((await rui({ method: 'PUT', path: `/spaces/${produto}/star` })).status).toBe(204)
    expect((await rui({ method: 'PUT', path: `/spaces/${crypto.randomUUID()}/star` })).status).toBe(404)
  })
})
