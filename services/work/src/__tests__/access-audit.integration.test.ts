import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * ADR-0024, Etapa 7c: periodic reviews — opened by an owner or by the schedule, answered item by
 * item, unanswered items removed when the window closes; the SLA report; the inventory loaded once;
 * and the history of the catalog.
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
/** Wednesday 2026-10-21, 12:00 in São Paulo. */
const START = new Date('2026-10-21T15:00:00.000Z')

let clock: ReturnType<typeof fixedClock>
let service: ReturnType<typeof buildService>

type Reply = { status: number; body: unknown }
type Item = { id: string } & Record<string, unknown>
type Body = Item & { items: Item[]; profiles: Item[] }

const as = (name: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(`${name}@uselets.com`) })))
const admin = as('admin')
const bruno = as('bruno')

const ok = async (call: Promise<Reply>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as Body
}

const people: Record<string, string> = {}
const PATH = '/access/entitlement-requests'

/** AWS, owned by Bruno and operated by Carla; Ana and Eduardo hold "Leitura" through the inventory. */
const aws = async () => {
  const system = await ok(admin({ method: 'POST', path: '/access/systems', body: { name: 'AWS' } }), 201)
  await ok(admin({ method: 'PUT', path: `/access/systems/${system.id}/staff/owner/${people.bruno}` }))
  await ok(admin({ method: 'PUT', path: `/access/systems/${system.id}/staff/operator/${people.carla}` }))
  for (const [name, privilege] of [
    ['Leitura', 'standard'],
    ['Administrador', 'privileged']
  ]) {
    await ok(bruno({ method: 'POST', path: `/access/systems/${system.id}/profiles`, body: { name, privilege } }), 201)
  }
  return system.id
}

const profileId = async (name: string): Promise<string> => {
  const [system] = (await ok(admin({ method: 'GET', path: '/access/systems' }))).items
  return ((system?.profiles ?? []) as Item[]).find((each) => each.name === name)?.id ?? ''
}

const load = (rows: Record<string, string>[]) =>
  ok(admin({ method: 'POST', path: '/access/entitlements/import', body: { rows } }))

const row = (who: string, profile: string, extra: Record<string, string> = {}) => ({
  email: `${who}@uselets.com`,
  system: 'aws',
  profile,
  ...extra
})

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(START)
  service = buildService(config, { db, clock })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  for (const name of ['ana', 'bruno', 'carla', 'daniela', 'eduardo']) {
    const body = { email: `${name}@uselets.com`, name }
    people[name] = (await ok(admin({ method: 'POST', path: '/members', body }), 201)).id
  }
})

describe('the inventory', () => {
  it('loads what is held today, skips what it cannot place, and never leaves privilege open-ended', async () => {
    await aws()
    const result = await load([
      row('ana', 'leitura', { grantedAt: '2025-03-01' }),
      row('eduardo', 'Administrador'),
      row('ana', 'Leitura'),
      row('ninguem', 'Leitura'),
      { ...row('ana', 'Leitura'), system: 'GitHub' },
      row('ana', 'Faturamento')
    ])
    const held = await ok(admin({ method: 'GET', path: '/access/entitlements' }))
    const privileged = held.items.find((each) => (each.member as { name: string }).name === 'eduardo')

    expect(result).toMatchObject({
      imported: 2,
      expiryAssigned: 1,
      skipped: [
        { row: 3, reason: 'already_held' },
        { row: 4, reason: 'unknown_person' },
        { row: 5, reason: 'unknown_system' },
        { row: 6, reason: 'unknown_profile' }
      ]
    })
    expect(privileged?.expiresAt).toBe(new Date(START.getTime() + 90 * DAY).toISOString())
    // Regression: the platform wrote "Initial inventory" where the screen shows a reason; now `origin` says it.
    expect(privileged).toMatchObject({ grantOrigin: 'inventory', grantReason: '' })
    expect(
      (
        await as('ana')({
          method: 'POST',
          path: '/access/entitlements/import',
          body: { rows: [row('ana', 'Leitura')] }
        })
      ).status
    ).toBe(403)
  })
})

describe('a review', () => {
  it('is answered by an owner item by item; a removal goes to the operators; done, it closes', async () => {
    const systemId = await aws()
    await load([row('ana', 'Leitura'), row('eduardo', 'Leitura')])
    const review = await ok(
      bruno({ method: 'POST', path: `/access/systems/${systemId}/reviews`, body: { privilege: 'standard' } }),
      201
    )
    const item = (name: string) =>
      review.items.find((each) => (each.member as { name: string }).name === name)?.entitlementId as string
    const decide = (who: string, decision: string) =>
      bruno({ method: 'POST', path: `/access/reviews/${review.id}/items/${item(who)}`, body: { decision } })

    await ok(decide('ana', 'keep'))
    const closed = await ok(decide('eduardo', 'remove'))
    const removal = (await ok(admin({ method: 'GET', path: PATH }))).items.find((each) => each.origin === 'review')

    expect(review.progress).toEqual({ decided: 0, total: 2 })
    expect(closed).toMatchObject({ closedAt: expect.any(String), progress: { decided: 2, total: 2 } })
    expect(removal).toMatchObject({ kind: 'removal', status: 'approved', beneficiary: { name: 'eduardo' } })
  })

  it('never lets an owner review their own access, nor anyone but an owner review at all', async () => {
    const systemId = await aws()
    await load([row('bruno', 'Leitura')])
    const review = await ok(
      bruno({ method: 'POST', path: `/access/systems/${systemId}/reviews`, body: { privilege: 'standard' } }),
      201
    )
    const path = `/access/reviews/${review.id}/items/${review.items[0]?.entitlementId}`

    expect((await bruno({ method: 'POST', path, body: { decision: 'keep' } })).status).toBe(403)
    expect((await as('carla')({ method: 'POST', path, body: { decision: 'keep' } })).status).toBe(403)
    expect(review.items[0]?.canDecide).toBe(false)
  })

  it('is opened by the schedule a quarter after the oldest privileged grant, and removes what nobody answered', async () => {
    await aws()
    await load([row('ana', 'Administrador', { expiresAt: '2027-06-30' })])
    expect(await service.reviews.sweep()).toEqual({ opened: 0, closed: 0 })

    clock.advance(91 * DAY)
    expect((await service.reviews.sweep()).opened).toBe(1)
    expect((await service.reviews.sweep()).opened).toBe(0)
    clock.advance(15 * DAY)
    expect((await service.reviews.sweep()).closed).toBe(1)
    const [review] = (await ok(admin({ method: 'GET', path: '/access/reviews' }))).items

    expect(review).toMatchObject({ openedBy: { name: 'Automação' }, closedAt: expect.any(String) })
    expect(review?.items).toMatchObject([
      { decision: 'remove', decided: { note: 'unanswered' }, removalRequestId: expect.any(String) }
    ])
  })

  it('tells the system owners it opened', async () => {
    const systemId = await aws()
    await load([row('ana', 'Leitura')])
    await ok(
      admin({ method: 'POST', path: `/access/systems/${systemId}/reviews`, body: { privilege: 'standard' } }),
      201
    )
    await service.drain()
    const inbox = await ok(bruno({ method: 'GET', path: '/me/notifications' }))
    expect(inbox.items.map((each) => each.kind)).toContain('access_review_opened')
  })
})

describe('the report', () => {
  it('counts, per system, what is held, what is privileged, and the SLA met in the period', async () => {
    await aws()
    await load([row('ana', 'Leitura'), row('eduardo', 'Administrador')])
    const reason = 'acompanhar custos do time'
    const body = { kind: 'grant', profileId: await profileId('Leitura'), reason }
    const ask = await ok(as('daniela')({ method: 'POST', path: PATH, body }), 201)
    await ok(bruno({ method: 'POST', path: `${PATH}/${ask.id}/decision`, body: { approve: true } }))
    clock.advance(10 * DAY)
    await ok(as('carla')({ method: 'POST', path: `${PATH}/${ask.id}/completion`, body: { evidence: 'feito tarde' } }))

    const report = await ok(
      admin({ method: 'GET', path: '/access/report', query: { from: '2026-10-01', to: '2026-12-31' } })
    )
    expect(report.items).toMatchObject([{ held: 3, privilegedHeld: 1, done: 1, onTime: 0, compliance: 0 }])
    expect(
      (await as('ana')({ method: 'GET', path: '/access/report', query: { from: '2026-10-01', to: '2026-12-31' } }))
        .status
    ).toBe(403)
  })
})

describe('the catalog history', () => {
  it('shows staff and auditors who changed the system and its profiles, and nobody else', async () => {
    const systemId = await aws()
    const history = await ok(as('carla')({ method: 'GET', path: `/access/systems/${systemId}/history` }))

    expect(history.items.map((each) => each.action)).toEqual([
      'created',
      'staff_added',
      'staff_added',
      'created',
      'created'
    ])
    expect((await as('ana')({ method: 'GET', path: `/access/systems/${systemId}/history` })).status).toBe(403)
  })
})
