import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * ADR-0024 end to end (Etapa 7a): a person asks for a profile with a reason, a system owner approves,
 * an operator carries it out with evidence, and only then is it held. Nobody decides for themselves;
 * the module shows each person what concerns them, and an auditor everything.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

let service: ReturnType<typeof buildService>

type Reply = { status: number; body: unknown }
const as = (name: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(`${name}@uselets.com`) })))
const admin = as('admin')
const ana = as('ana')
const bruno = as('bruno')
const carla = as('carla')
const daniela = as('daniela')

type Item = { id: string } & Record<string, unknown>
type Body = Item & { items: Item[]; profiles: Item[] }

const ok = async (call: Promise<Reply>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as Body
}

const people: Record<string, string> = {}
const invite = async (name: string) => {
  people[name] = (
    await ok(admin({ method: 'POST', path: '/members', body: { email: `${name}@uselets.com`, name } }), 201)
  ).id
}

const REASON = 'investigar incidente INC-12 em produção'

/** AWS, owned by Bruno and operated by Carla, with a standard and a privileged profile. */
const aws = async () => {
  const system = await ok(admin({ method: 'POST', path: '/access/systems', body: { name: 'AWS' } }), 201)
  await ok(admin({ method: 'PUT', path: `/access/systems/${system.id}/staff/owner/${people.bruno}` }))
  await ok(admin({ method: 'PUT', path: `/access/systems/${system.id}/staff/operator/${people.carla}` }))
  const profile = (name: string, privilege: string) =>
    ok(bruno({ method: 'POST', path: `/access/systems/${system.id}/profiles`, body: { name, privilege } }), 201)
  await profile('Leitura produção', 'standard')
  const view = await profile('Administrador', 'privileged')
  const id = (name: string) => view.profiles.find((each) => each.name === name)?.id as string
  return { systemId: system.id, read: id('Leitura produção'), adminProfile: id('Administrador') }
}

const askRead = async (profileId: string) =>
  await ok(
    ana({ method: 'POST', path: '/access/entitlement-requests', body: { kind: 'grant', profileId, reason: REASON } }),
    201
  )

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  for (const name of ['ana', 'bruno', 'carla', 'daniela', 'eduardo']) {
    await invite(name)
  }
})

describe('the catalog', () => {
  it('is kept by an organization admin; profiles by an owner; seen by everyone', async () => {
    const refused = await ana({ method: 'POST', path: '/access/systems', body: { name: 'GitHub' } })
    const { systemId } = await aws()
    const notOwner = await carla({
      method: 'POST',
      path: `/access/systems/${systemId}/profiles`,
      body: { name: 'Billing', privilege: 'standard' }
    })
    const listed = await ok(ana({ method: 'GET', path: '/access/systems' }))

    expect(refused.status).toBe(403)
    expect(notOwner.status).toBe(403)
    expect(listed.items[0]?.profiles).toHaveLength(2)
  })
})

describe('a grant', () => {
  it('needs a reason, an owner to approve and an operator to carry it out, and only then is held', async () => {
    const { read } = await aws()
    const short = await ana({
      method: 'POST',
      path: '/access/entitlement-requests',
      body: { kind: 'grant', profileId: read, reason: 'ok' }
    })
    const request = await askRead(read)
    const early = await carla({
      method: 'POST',
      path: `/access/entitlement-requests/${request.id}/completion`,
      body: { evidence: 'feito' }
    })
    const held = () => ok(ana({ method: 'GET', path: '/access/entitlements' })) as Promise<{ items: unknown[] }>
    expect((await held()).items).toHaveLength(0)

    await ok(
      bruno({ method: 'POST', path: `/access/entitlement-requests/${request.id}/decision`, body: { approve: true } })
    )
    const done = await ok(
      carla({
        method: 'POST',
        path: `/access/entitlement-requests/${request.id}/completion`,
        body: { evidence: 'usuário criado' }
      })
    )

    expect(short.status).toBe(400)
    expect(early.status).toBe(409)
    expect(done).toMatchObject({
      status: 'done',
      reason: REASON,
      decided: { by: { name: 'bruno' } },
      completed: { by: { name: 'carla' }, evidence: 'usuário criado' }
    })
    expect((await held()).items).toMatchObject([{ profile: { name: 'Leitura produção' }, grantReason: REASON }])
  })

  it('cannot be approved nor carried out by whom it names, even an organization admin', async () => {
    const { read } = await aws()
    const own = await ok(
      bruno({
        method: 'POST',
        path: '/access/entitlement-requests',
        body: { kind: 'grant', profileId: read, reason: REASON }
      }),
      201
    )
    const selfApproval = await bruno({
      method: 'POST',
      path: `/access/entitlement-requests/${own.id}/decision`,
      body: { approve: true }
    })
    const asked = await ok(
      admin({
        method: 'POST',
        path: '/access/entitlement-requests',
        body: { kind: 'grant', profileId: read, reason: REASON }
      }),
      201
    )
    const adminApproval = await admin({
      method: 'POST',
      path: `/access/entitlement-requests/${asked.id}/decision`,
      body: { approve: true }
    })

    const operators = await ok(
      carla({
        method: 'POST',
        path: '/access/entitlement-requests',
        body: { kind: 'grant', profileId: read, reason: REASON }
      }),
      201
    )
    await ok(
      bruno({ method: 'POST', path: `/access/entitlement-requests/${operators.id}/decision`, body: { approve: true } })
    )
    const selfService = await carla({
      method: 'POST',
      path: `/access/entitlement-requests/${operators.id}/completion`,
      body: { evidence: 'me dei acesso' }
    })

    expect(selfApproval).toMatchObject({
      status: 403,
      body: { error: { message: expect.stringContaining('it names you') } }
    })
    expect(adminApproval.status).toBe(403)
    expect(selfService.status).toBe(403)
  })

  it('of a privileged profile needs an expiry, 90 days ahead at most', async () => {
    const { adminProfile } = await aws()
    const body = (expiresAt?: string) => ({ kind: 'grant', profileId: adminProfile, reason: REASON, expiresAt })
    const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

    expect((await ana({ method: 'POST', path: '/access/entitlement-requests', body: body() })).status).toBe(400)
    expect((await ana({ method: 'POST', path: '/access/entitlement-requests', body: body(ahead(120)) })).status).toBe(
      400
    )
    expect((await ana({ method: 'POST', path: '/access/entitlement-requests', body: body(ahead(30)) })).status).toBe(
      201
    )
  })

  it('is asked for someone else only by an owner of their group or by the system staff', async () => {
    const { read } = await aws()
    const body = { kind: 'grant', profileId: read, reason: REASON, beneficiaryId: people.eduardo }
    const refused = await ana({ method: 'POST', path: '/access/entitlement-requests', body })
    const group = await ok(admin({ method: 'POST', path: '/groups', body: { name: 'Produto' } }), 201)
    await ok(admin({ method: 'PUT', path: `/groups/${group.id}/members/${people.ana}`, body: { isOwner: true } }))
    await ok(ana({ method: 'PUT', path: `/groups/${group.id}/members/${people.eduardo}`, body: {} }))

    expect(refused.status).toBe(403)
    expect((await ana({ method: 'POST', path: '/access/entitlement-requests', body })).status).toBe(201)
    expect((await ana({ method: 'POST', path: '/access/entitlement-requests', body })).status).toBe(409)
  })
})

describe('a removal', () => {
  it('waits for an operator at once, and ends the entitlement with its history kept', async () => {
    const { read } = await aws()
    const grant = await askRead(read)
    await ok(
      bruno({ method: 'POST', path: `/access/entitlement-requests/${grant.id}/decision`, body: { approve: true } })
    )
    await ok(
      carla({
        method: 'POST',
        path: `/access/entitlement-requests/${grant.id}/completion`,
        body: { evidence: 'criado' }
      })
    )
    const [entitlement] = (
      (await ok(ana({ method: 'GET', path: '/access/entitlements' }))) as { items: { id: string }[] }
    ).items

    const removal = await ok(
      bruno({
        method: 'POST',
        path: '/access/entitlement-requests',
        body: { kind: 'removal', entitlementId: entitlement?.id, reason: 'mudou de função para o comercial' }
      }),
      201
    )
    await ok(
      carla({
        method: 'POST',
        path: `/access/entitlement-requests/${removal.id}/completion`,
        body: { evidence: 'removido' }
      })
    )
    const all = await ok(ana({ method: 'GET', path: '/access/entitlements', query: { held: 'false' } }))

    expect(removal.status).toBe('approved')
    expect(
      ((await ok(ana({ method: 'GET', path: '/access/entitlements' }))) as { items: unknown[] }).items
    ).toHaveLength(0)
    expect(all.items).toMatchObject([{ removalRequestId: removal.id, removedAt: expect.any(String) }])
  })
})

describe('who sees what', () => {
  it('shows a person their own requests, staff their systems, and an auditor everything', async () => {
    const { read } = await aws()
    await askRead(read)
    const count = async (who: ReturnType<typeof as>) =>
      ((await ok(who({ method: 'GET', path: '/access/entitlement-requests' }))) as { items: unknown[] }).items.length

    expect(await count(ana)).toBe(1)
    expect(await count(carla)).toBe(1)
    expect(await count(daniela)).toBe(0)
    await ok(
      admin({ method: 'POST', path: `/members/${people.daniela}/access-auditor`, body: { isAccessAuditor: true } })
    )
    expect(await count(daniela)).toBe(1)
  })

  it('answers "does not exist" for a request one may not see', async () => {
    const { read } = await aws()
    const request = await askRead(read)
    expect((await as('eduardo')({ method: 'GET', path: `/access/entitlement-requests/${request.id}` })).status).toBe(
      404
    )
  })
})
