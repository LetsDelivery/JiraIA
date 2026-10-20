import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * ADR-0012 end to end: all of LET’S reads every space; roles come from people and groups; space
 * managers create JiraIA spaces; whoever may only read asks to edit, and a space admin answers.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

let service: ReturnType<typeof buildService>

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

const createSpace = async (key: string) =>
  (
    (await ok(admin({ method: 'POST', path: '/spaces', body: { key, name: key, type: 'business' } }), 201)) as {
      id: string
    }
  ).id

const createGroup = async (name: string) =>
  ((await ok(admin({ method: 'POST', path: '/groups', body: { name } }), 201)) as { id: string }).id

const addCard = (who: ReturnType<typeof as>, spaceId: string) =>
  who({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title: 'Nova' } })

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
})

describe('space managers', () => {
  it('lets an organization admin name a space manager, who then creates spaces', async () => {
    const ana = await invite('ana@uselets.com')
    const body = { key: 'OPS', name: 'Operações', type: 'business' }

    expect((await as('ana@uselets.com')({ method: 'POST', path: '/spaces', body })).status).toBe(403)
    await ok(admin({ method: 'POST', path: `/members/${ana}/space-manager`, body: { isSpaceManager: true } }))
    expect((await as('ana@uselets.com')({ method: 'POST', path: '/spaces', body })).status).toBe(201)
  })
})

describe('groups', () => {
  it('an admin creates a group and names an owner, who adds members; nobody else changes it', async () => {
    const produto = await createGroup('Produto')
    const ana = await invite('ana@uselets.com')
    const rui = await invite('rui@uselets.com')
    const path = (memberId: string) => `/groups/${produto}/members/${memberId}`

    await ok(admin({ method: 'PUT', path: path(ana), body: { isOwner: true } }))
    await ok(as('ana@uselets.com')({ method: 'PUT', path: path(rui), body: {} }))
    const refused = await as('rui@uselets.com')({ method: 'DELETE', path: path(ana) })
    const promoted = await as('ana@uselets.com')({ method: 'PUT', path: path(rui), body: { isOwner: true } })

    expect(refused.status).toBe(403)
    expect(promoted.status).toBe(403)
    const group = (await ok(as('rui@uselets.com')({ method: 'GET', path: `/groups/${produto}` }))) as {
      members: { name: string; isOwner: boolean }[]
      canEdit: boolean
    }
    expect(group.members.map((each) => [each.name, each.isOwner])).toEqual([
      ['ana@uselets.com', true],
      ['rui@uselets.com', false]
    ])
    expect(group.canEdit).toBe(false)
  })

  it('refuses a second group of the same name', async () => {
    await createGroup('Produto')
    expect((await admin({ method: 'POST', path: '/groups', body: { name: 'produto' } })).status).toBe(409)
  })
})

describe('roles through groups', () => {
  it('a group’s role reaches its members, says where it comes from, and stops when they leave', async () => {
    const req = await createSpace('REQ')
    const group = await createGroup('Produto')
    const ana = await invite('ana@uselets.com')
    const anaCalls = as('ana@uselets.com')
    await ok(admin({ method: 'PUT', path: `/groups/${group}/members/${ana}`, body: {} }))

    expect((await addCard(anaCalls, req)).status).toBe(403)
    await ok(admin({ method: 'PUT', path: `/spaces/${req}/groups/${group}`, body: { role: 'member' } }))
    expect((await addCard(anaCalls, req)).status).toBe(201)
    const shown = (await ok(anaCalls({ method: 'GET', path: `/groups/${group}` }))) as { access: unknown[] }
    expect(shown.access).toEqual([{ product: 'jiraia', spaceId: req, label: 'REQ', name: 'REQ', role: 'member' }])

    const why = (await ok(anaCalls({ method: 'GET', path: `/spaces/${req}/access/me` }))) as Record<string, unknown>
    expect(why).toMatchObject({
      role: 'member',
      canWrite: true,
      canManage: false,
      sources: [
        { source: 'group', role: 'member', groupName: 'Produto' },
        { source: 'organization', role: 'reader' }
      ]
    })
    await ok(admin({ method: 'DELETE', path: `/groups/${group}/members/${ana}` }))
    expect((await addCard(anaCalls, req)).status).toBe(403)
  })

  it('lists the grants of a space to anyone, and lets only its admins change them', async () => {
    const req = await createSpace('REQ')
    const group = await createGroup('Tecnologia')
    await invite('rui@uselets.com')
    await ok(admin({ method: 'PUT', path: `/spaces/${req}/groups/${group}`, body: { role: 'reader' } }))

    const seen = (await ok(as('rui@uselets.com')({ method: 'GET', path: `/spaces/${req}/grants` }))) as {
      general: unknown
      groups: { name: string; role: string }[]
      canManage: boolean
    }
    const refused = await as('rui@uselets.com')({ method: 'DELETE', path: `/spaces/${req}/groups/${group}` })

    expect(seen).toMatchObject({
      general: { scope: 'organization', role: 'reader' },
      groups: [{ name: 'Tecnologia', role: 'reader', memberCount: 0 }],
      canManage: false
    })
    expect(refused.status).toBe(403)
  })

  it('refuses guest: the role does not exist — everyone of LET’S signs in and reads', async () => {
    const req = await createSpace('REQ')
    const group = await createGroup('Produto')
    const put = await admin({ method: 'PUT', path: `/spaces/${req}/groups/${group}`, body: { role: 'guest' } })
    expect(put.status).toBe(400)
  })
})

describe('LET’S Draw AI roles', () => {
  it('its creator holds it; a member without a role reads but does not edit until given one', async () => {
    const space = (await ok(
      as('admin@uselets.com')({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } }),
      201
    )) as { id: string }
    const rui = await invite('rui@uselets.com')
    const ruiCalls = as('rui@uselets.com')
    const create = () => ruiCalls({ method: 'POST', path: `/draw/spaces/${space.id}/contents`, body: { title: 'Ata' } })

    const read = (await ok(ruiCalls({ method: 'GET', path: `/draw/spaces/${space.id}` }))) as Record<string, unknown>
    expect(read).toMatchObject({ canWrite: false, canManage: false })
    expect((await create()).status).toBe(403)
    await ok(admin({ method: 'PUT', path: `/draw/spaces/${space.id}/members/${rui}`, body: { role: 'member' } }))
    expect((await create()).status).toBe(201)
  })
})

describe('access requests', () => {
  it('a reader asks, the space admin sees it waiting and approves: the reader becomes a member', async () => {
    const req = await createSpace('REQ')
    await invite('rui@uselets.com')
    const rui = as('rui@uselets.com')
    const asked = (await ok(
      rui({
        method: 'POST',
        path: '/access-requests',
        body: { product: 'jiraia', spaceId: req, message: 'Sou do CS' }
      }),
      201
    )) as { id: string }

    const again = await rui({ method: 'POST', path: '/access-requests', body: { product: 'jiraia', spaceId: req } })
    const waiting = (await ok(
      admin({ method: 'GET', path: '/access-requests', query: { product: 'jiraia', spaceId: req } })
    )) as { items: { id: string; spaceName: string; message: string }[] }
    const peek = await rui({ method: 'GET', path: '/access-requests', query: { product: 'jiraia', spaceId: req } })

    expect(again.status).toBe(409)
    expect(waiting.items).toMatchObject([{ id: asked.id, spaceName: 'REQ', message: 'Sou do CS' }])
    expect(peek.status).toBe(403)
    const path = `/access-requests/${asked.id}/decision`
    expect(await ok(admin({ method: 'POST', path, body: { approve: true } }))).toMatchObject({ status: 'approved' })
    expect((await addCard(rui, req)).status).toBe(201)
    expect((await admin({ method: 'POST', path, body: { approve: false } })).status).toBe(409)
  })

  it('a declined request grants nothing; the person sees it among their own', async () => {
    const space = (await ok(admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Jurídico' } }), 201)) as {
      id: string
    }
    await invite('rui@uselets.com')
    const rui = as('rui@uselets.com')
    const asked = (await ok(
      rui({ method: 'POST', path: '/access-requests', body: { product: 'draw', spaceId: space.id } }),
      201
    )) as { id: string }

    await ok(admin({ method: 'POST', path: `/access-requests/${asked.id}/decision`, body: { approve: false } }))

    const mine = (await ok(rui({ method: 'GET', path: '/access-requests' }))) as { items: { status: string }[] }
    expect(mine.items).toMatchObject([{ status: 'declined', spaceName: 'Jurídico' }])
    const read = (await ok(rui({ method: 'GET', path: `/draw/spaces/${space.id}` }))) as { canWrite: boolean }
    expect(read.canWrite).toBe(false)
  })

  it('refuses a request from someone who already edits the space', async () => {
    const req = await createSpace('REQ')
    const asked = await admin({ method: 'POST', path: '/access-requests', body: { product: 'jiraia', spaceId: req } })
    expect(asked.status).toBe(409)
  })
})
