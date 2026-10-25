import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * ADR-0024, Etapa 7b: every request carries a deadline from its system's SLA on the São Paulo
 * calendar; a departure removes everything within 24 hours; an expired privileged grant opens its own
 * removal; a request past its deadline is marked overdue once, and its owners and operators hear of it.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Friday 2026-10-23, 15:00 in São Paulo. */
const FRIDAY = new Date('2026-10-23T18:00:00.000Z')

let clock: ReturnType<typeof fixedClock>
let service: ReturnType<typeof buildService>

type Reply = { status: number; body: unknown }
type Item = { id: string } & Record<string, unknown>
type Body = Item & { items: Item[]; profiles: Item[] }

const as = (name: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(`${name}@uselets.com`) })))
const admin = as('admin')
const ana = as('ana')
const bruno = as('bruno')

const ok = async (call: Promise<Reply>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as Body
}

const people: Record<string, string> = {}
const REASON = 'investigar incidente INC-12 em produção'
const PATH = '/access/entitlement-requests'

/** AWS, owned by Bruno and operated by Carla. */
const aws = async () => {
  const system = await ok(admin({ method: 'POST', path: '/access/systems', body: { name: 'AWS' } }), 201)
  await ok(admin({ method: 'PUT', path: `/access/systems/${system.id}/staff/owner/${people.bruno}` }))
  await ok(admin({ method: 'PUT', path: `/access/systems/${system.id}/staff/operator/${people.carla}` }))
  const add = (name: string, privilege: string) =>
    ok(bruno({ method: 'POST', path: `/access/systems/${system.id}/profiles`, body: { name, privilege } }), 201)
  await add('Leitura', 'standard')
  const view = await add('Administrador', 'privileged')
  const id = (name: string) => view.profiles.find((each) => each.name === name)?.id as string
  return { systemId: system.id, read: id('Leitura'), privileged: id('Administrador') }
}

/** A grant asked by Ana, approved by Bruno and carried out by Carla — the entitlement it made. */
const held = async (profileId: string, expiresAt?: string) => {
  const request = await ok(
    ana({ method: 'POST', path: PATH, body: { kind: 'grant', profileId, reason: REASON, expiresAt } }),
    201
  )
  await ok(bruno({ method: 'POST', path: `${PATH}/${request.id}/decision`, body: { approve: true } }))
  await ok(as('carla')({ method: 'POST', path: `${PATH}/${request.id}/completion`, body: { evidence: 'feito' } }))
  return request.id
}

const requests = async () => (await ok(admin({ method: 'GET', path: PATH }))).items

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(FRIDAY)
  service = buildService(config, { db, clock })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  for (const name of ['ana', 'bruno', 'carla']) {
    people[name] = (
      await ok(admin({ method: 'POST', path: '/members', body: { email: `${name}@uselets.com`, name } }), 201)
    ).id
  }
})

describe('deadlines', () => {
  it('start for a grant at approval, 2 business days on, past the weekend and a holiday', async () => {
    const { read } = await aws()
    await ok(admin({ method: 'PUT', path: '/access/holidays/2026-10-26', body: { name: 'Dia da empresa' } }))
    const request = await ok(
      ana({ method: 'POST', path: PATH, body: { kind: 'grant', profileId: read, reason: REASON } }),
      201
    )
    const approved = await ok(
      bruno({ method: 'POST', path: `${PATH}/${request.id}/decision`, body: { approve: true } })
    )

    expect(request.dueAt).toBeNull()
    expect(approved.dueAt).toBe('2026-10-28T18:00:00.000Z')
  })

  it('start for a removal when it is asked, 1 business day on', async () => {
    const { read } = await aws()
    await held(read)
    const [entitlement] = (await ok(ana({ method: 'GET', path: '/access/entitlements' }))).items
    const removal = await ok(
      ana({
        method: 'POST',
        path: PATH,
        body: { kind: 'removal', entitlementId: entitlement?.id, reason: 'não preciso mais disso' }
      }),
      201
    )
    expect(removal.dueAt).toBe('2026-10-26T18:00:00.000Z')
  })

  it('follow the SLA an admin sets on the system', async () => {
    const { systemId, read } = await aws()
    await ok(admin({ method: 'PATCH', path: `/access/systems/${systemId}`, body: { grantSlaDays: 5 } }))
    const request = await ok(
      ana({ method: 'POST', path: PATH, body: { kind: 'grant', profileId: read, reason: REASON } }),
      201
    )
    const approved = await ok(
      bruno({ method: 'POST', path: `${PATH}/${request.id}/decision`, body: { approve: true } })
    )
    expect(approved.dueAt).toBe('2026-10-30T18:00:00.000Z')
  })
})

describe('a departure', () => {
  it('opens, with the deactivation, a removal of everything held, due in 24 hours, and cancels what waits', async () => {
    const { read, privileged } = await aws()
    await held(read)
    const waiting = await ok(
      ana({
        method: 'POST',
        path: PATH,
        body: {
          kind: 'grant',
          profileId: privileged,
          reason: REASON,
          expiresAt: new Date(FRIDAY.getTime() + 10 * DAY).toISOString()
        }
      }),
      201
    )
    await ok(admin({ method: 'POST', path: `/members/${people.ana}/deactivate` }))
    const all = await requests()
    const removal = all.find((each) => each.kind === 'removal')

    expect(removal).toMatchObject({
      origin: 'departure',
      status: 'approved',
      requester: { name: 'Automação' },
      dueAt: new Date(FRIDAY.getTime() + DAY).toISOString()
    })
    expect(all.find((each) => each.id === waiting.id)?.status).toBe('cancelled')
    const carla = await ok(
      as('carla')({ method: 'POST', path: `${PATH}/${removal?.id}/completion`, body: { evidence: 'conta removida' } })
    )
    expect(carla.status).toBe('done')
  })
})

describe('the clock', () => {
  it('opens the removal of a privileged grant once it expires, and only once', async () => {
    const { privileged } = await aws()
    await held(privileged, new Date(FRIDAY.getTime() + 3 * DAY).toISOString())
    expect(await service.accessClock.sweep()).toEqual({ expired: 0, overdue: 0 })
    // The clock is woken for the expiry, and the privileged review 90 days after the grant (ADR-0035).
    expect(await service.accessClock.nextDue()).toEqual(new Date(FRIDAY.getTime() + 3 * DAY))
    expect(await service.reviews.nextDue()).toEqual(new Date(FRIDAY.getTime() + 90 * DAY))

    clock.advance(3 * DAY + HOUR)
    expect((await service.accessClock.sweep()).expired).toBe(1)
    expect((await service.accessClock.sweep()).expired).toBe(0)
    // Now the removal it opened is what the clock waits for: its deadline, a business day on.
    expect((await service.accessClock.nextDue())?.getTime()).toBeGreaterThan(clock.now().getTime())
    expect((await requests()).filter((each) => each.origin === 'expiry')).toHaveLength(1)
  })

  it('marks a request overdue once, tells owners and operators, and keeps the breach on record', async () => {
    const { read } = await aws()
    const request = await ok(
      ana({ method: 'POST', path: PATH, body: { kind: 'grant', profileId: read, reason: REASON } }),
      201
    )
    await ok(bruno({ method: 'POST', path: `${PATH}/${request.id}/decision`, body: { approve: true } }))
    const due = await service.accessClock.nextDue()
    expect(due?.getTime()).toBeGreaterThan(FRIDAY.getTime())
    expect(due?.getTime()).toBeLessThan(FRIDAY.getTime() + 5 * DAY)
    clock.advance(5 * DAY)

    expect((await service.accessClock.sweep()).overdue).toBe(1)
    expect((await service.accessClock.sweep()).overdue).toBe(0)
    expect(await service.accessClock.nextDue()).toBeNull()
    await service.drain()
    const inbox = await ok(as('carla')({ method: 'GET', path: '/me/notifications' }))
    await ok(
      as('carla')({ method: 'POST', path: `${PATH}/${request.id}/completion`, body: { evidence: 'feito com atraso' } })
    )
    const after = await ok(ana({ method: 'GET', path: `${PATH}/${request.id}` }))

    expect(inbox.items.map((each) => each.kind).sort()).toEqual(['entitlement_overdue', 'entitlement_waiting'])
    expect(after).toMatchObject({ status: 'done', overdue: true })
  })
})

describe('the calendar', () => {
  it('is changed by an organization admin only, and never over a national holiday', async () => {
    const refused = await ana({
      method: 'PUT',
      path: '/access/holidays/2026-01-25',
      body: { name: 'Aniversário de SP' }
    })
    const national = await admin({ method: 'PUT', path: '/access/holidays/2026-11-02', body: { name: 'Finados' } })
    const days = await ok(
      admin({ method: 'PUT', path: '/access/holidays/2026-01-25', body: { name: 'Aniversário de SP' } })
    )

    expect(refused.status).toBe(403)
    expect(national.status).toBe(409)
    const listed = days.items as unknown[]
    expect(listed).toContainEqual({ day: '2026-01-25', name: 'Aniversário de SP', national: false })
    expect(listed).toContainEqual({ day: '2026-11-02', name: '', national: true })
  })
})
