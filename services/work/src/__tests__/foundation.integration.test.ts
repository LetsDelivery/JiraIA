import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { and, eq } from 'drizzle-orm'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { auditEvents } from '../schema.js'

/**
 * Etapa 1's definition of done, end to end through the router: an admin creates the space REQ,
 * invites people with roles, and a reader cannot change it.
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

const call = async (input: Call) => answer(await service.router(apiEvent(input)))
/** Calls as the person who signed in with Google as `email`. */
const as = (email: string) => (input: Omit<Call, 'subject'>) => call({ ...input, claims: googleClaims(email) })
const admin = as('admin@uselets.com')

const createSpace = async (key: string, name = key, type = 'business') => {
  const created = await admin({ method: 'POST', path: '/spaces', body: { key, name, type } })
  expect(created.status).toBe(201)
  return created.body as { id: string; key: string }
}

/** Invites a person and answers with their member id and the address they will sign in with. */
const invite = async (email: string, name: string) => {
  const invited = await admin({ method: 'POST', path: '/members', body: { email, name } })
  expect(invited.status).toBe(201)
  return { id: (invited.body as { id: string }).id, email }
}

const grant = (spaceId: string, memberId: string, role: string) =>
  admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${memberId}`, body: { role } })

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
})

describe('Etapa 1 — pronto quando', () => {
  it('lets an admin create the space REQ, invite people with roles, and keeps a reader from changing it', async () => {
    const created = await admin({
      method: 'POST',
      path: '/spaces',
      body: { key: 'req', name: 'Requisições', type: 'business' }
    })
    expect(created).toMatchObject({
      status: 201,
      body: { key: 'REQ', type: 'business', lead: { name: 'Admin' }, lastCardActivityAt: null }
    })
    const spaceId = (created.body as { id: string }).id

    const writer = await invite('ana@uselets.com', 'Ana')
    const reader = await invite('rui@uselets.com', 'Rui')
    expect((await grant(spaceId, writer.id, 'member')).status).toBe(200)
    expect((await grant(spaceId, reader.id, 'reader')).status).toBe(200)

    expect((await as(reader.email)({ method: 'GET', path: `/spaces/${spaceId}` })).status).toBe(200)
    const refused = await as(reader.email)({ method: 'PATCH', path: `/spaces/${spaceId}`, body: { name: 'Outro' } })
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({
      error: { code: 'FORBIDDEN', details: { action: 'space:manage', spaceRole: 'reader' } }
    })
    const body = { key: 'X1', name: 'x', type: 'business' }
    expect((await as(reader.email)({ method: 'POST', path: '/spaces', body })).status).toBe(403)
  })
})

describe('authentication', () => {
  it('answers 401 without a token, and 403 for a token that names nobody of the domain', async () => {
    expect((await call({ method: 'GET', path: '/spaces' })).status).toBe(401)
    expect((await call({ method: 'GET', path: '/spaces', subject: crypto.randomUUID() })).status).toBe(403)
  })

  it('answers /health without a token', async () => {
    expect(await call({ method: 'GET', path: '/health' })).toEqual({
      status: 200,
      body: { service: 'work', status: 'ok' }
    })
  })
})

describe('spaces', () => {
  it('lists every space of the organization to every member, with or without a role (ADR-0012)', async () => {
    await createSpace('PRD', 'Produto')
    await createSpace('JUR', 'Jurídico')
    const ana = await invite('ana@uselets.com', 'Ana')

    const listed = await as(ana.email)({ method: 'GET', path: '/spaces' })

    expect((listed.body as { items: { key: string }[] }).items.map((space) => space.key).sort()).toEqual(['JUR', 'PRD'])
  })

  it('lets a member with no role read a space, but not change it', async () => {
    const space = await createSpace('PRD')
    const newcomer = await invite('rui@uselets.com', 'Rui')
    const path = `/spaces/${space.id}`

    expect((await as(newcomer.email)({ method: 'GET', path })).status).toBe(200)
    expect((await as(newcomer.email)({ method: 'PATCH', path, body: { name: 'x' } })).status).toBe(403)
  })

  it('answers 404 for a space id that does not exist', async () => {
    const someone = await invite('rui@uselets.com', 'Rui')

    expect((await as(someone.email)({ method: 'GET', path: `/spaces/${crypto.randomUUID()}` })).status).toBe(404)
  })

  it('refuses a second space with the same key, and a malformed key with a 400', async () => {
    await createSpace('REQ')

    const duplicate = await admin({
      method: 'POST',
      path: '/spaces',
      body: { key: 'req', name: 'x', type: 'business' }
    })
    const malformed = await admin({
      method: 'POST',
      path: '/spaces',
      body: { key: '1REQ', name: 'x', type: 'business' }
    })

    expect(duplicate.status).toBe(409)
    expect(malformed).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } })
  })

  it('changes the type and the lead, keeps the key, and refuses a lead who is not an active member', async () => {
    const space = await createSpace('TEC', 'Tecnologia', 'business')
    const ana = await invite('ana@uselets.com', 'Ana')
    const path = `/spaces/${space.id}`

    const updated = await admin({ method: 'PATCH', path, body: { type: 'software', leadId: ana.id } })
    const missing = await admin({ method: 'PATCH', path, body: { leadId: crypto.randomUUID() } })

    expect(updated.body).toMatchObject({ key: 'TEC', type: 'software', lead: { id: ana.id, name: 'Ana' } })
    expect(missing.status).toBe(404)
  })

  it('archives a space, refuses edits while archived, and restores it', async () => {
    const space = await createSpace('PRD')

    const archived = await admin({ method: 'POST', path: `/spaces/${space.id}/archive` })
    expect(archived.body).toMatchObject({ archivedAt: expect.any(String) })
    expect((await admin({ method: 'PATCH', path: `/spaces/${space.id}`, body: { name: 'X' } })).status).toBe(409)
    const listed = await admin({ method: 'GET', path: '/spaces', query: { archived: 'true' } })
    expect(listed.body).toMatchObject({ items: [{ id: space.id }] })
    const restored = await admin({ method: 'POST', path: `/spaces/${space.id}/unarchive` })
    expect(restored.body).toMatchObject({ archivedAt: null })
  })
})

describe('members', () => {
  it('deactivates a person without deleting them and cuts their access', async () => {
    const ana = await invite('ana@uselets.com', 'Ana')

    const deactivated = await admin({ method: 'POST', path: `/members/${ana.id}/deactivate` })

    expect(deactivated.body).toMatchObject({ status: 'inactive', deactivatedAt: expect.any(String) })
    expect((await as(ana.email)({ method: 'GET', path: '/me' })).status).toBe(403)
    expect((await admin({ method: 'GET', path: '/members' })).body).toMatchObject({
      items: [{ name: 'Admin' }, { name: 'Ana', status: 'inactive' }]
    })
  })

  it('refuses inviting the same email twice', async () => {
    await invite('ana@uselets.com', 'Ana')

    const again = await admin({ method: 'POST', path: '/members', body: { email: 'ANA@uselets.com', name: 'Ana' } })

    expect(again.status).toBe(409)
  })

  it('makes someone an organization admin, who can then create spaces, and refuses removing oneself', async () => {
    const ana = await invite('ana@uselets.com', 'Ana')
    const me = (await admin({ method: 'GET', path: '/me' })).body as { id: string }

    const made = await admin({ method: 'POST', path: `/members/${ana.id}/org-admin`, body: { isOrgAdmin: true } })
    const created = await as(ana.email)({
      method: 'POST',
      path: '/spaces',
      body: { key: 'ANA', name: 'Ana', type: 'business' }
    })
    const self = await admin({ method: 'POST', path: `/members/${me.id}/org-admin`, body: { isOrgAdmin: false } })

    expect(made.body).toMatchObject({ isOrgAdmin: true })
    expect(created.status).toBe(201)
    expect(self.status).toBe(409)
  })

  it('keeps invitations to organization admins', async () => {
    const ana = await invite('ana@uselets.com', 'Ana')

    const refused = await as(ana.email)({
      method: 'POST',
      path: '/members',
      body: { email: 'x@uselets.com', name: 'X' }
    })

    expect(refused.status).toBe(403)
  })
})

describe('profile', () => {
  it('lets a person change their own name and job title, shown apart in the list and audited', async () => {
    const ana = await invite('ana@uselets.com', 'Ana (Produto)')

    const updated = await as(ana.email)({
      method: 'PATCH',
      path: '/me',
      body: { name: 'Ana Souza', jobTitle: '  Gerente de produto ' }
    })

    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ name: 'Ana Souza', jobTitle: 'Gerente de produto' })
    expect((await admin({ method: 'GET', path: '/members' })).body).toMatchObject({
      items: [
        { name: 'Admin', jobTitle: null },
        { name: 'Ana Souza', jobTitle: 'Gerente de produto' }
      ]
    })
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, ana.id), eq(auditEvents.action, 'profile_updated')))
    expect(event?.changes).toEqual({
      name: { before: 'Ana (Produto)', after: 'Ana Souza' },
      jobTitle: { before: null, after: 'Gerente de produto' }
    })
  })

  it('clears a blank job title and keeps the name when only the title is sent', async () => {
    const ana = await invite('ana@uselets.com', 'Ana')
    await as(ana.email)({ method: 'PATCH', path: '/me', body: { jobTitle: 'Designer' } })

    const cleared = await as(ana.email)({ method: 'PATCH', path: '/me', body: { jobTitle: '   ' } })

    expect(cleared.body).toMatchObject({ name: 'Ana', jobTitle: null })
  })

  it('refuses an empty name and an empty change', async () => {
    const ana = await invite('ana@uselets.com', 'Ana')

    const blank = await as(ana.email)({ method: 'PATCH', path: '/me', body: { name: '  ' } })
    const nothing = await as(ana.email)({ method: 'PATCH', path: '/me', body: {} })

    expect(blank.status).toBe(400)
    expect(nothing.status).toBe(400)
  })

  it('takes a job title on the invitation', async () => {
    const invited = await admin({
      method: 'POST',
      path: '/members',
      body: { email: 'gil@uselets.com', name: 'Gil', jobTitle: 'Engenheiro de software' }
    })

    expect(invited.body).toMatchObject({ name: 'Gil', jobTitle: 'Engenheiro de software' })
  })
})

describe('audit', () => {
  it('records every write in the space with actor, before and after', async () => {
    const space = await createSpace('PRD', 'Produto')
    await admin({ method: 'PATCH', path: `/spaces/${space.id}`, body: { name: 'Produto & Design' } })
    const ana = await invite('ana@uselets.com', 'Ana')
    await grant(space.id, ana.id, 'reader')
    await grant(space.id, ana.id, 'member')

    const history = (await admin({ method: 'GET', path: `/spaces/${space.id}/history` })).body as {
      items: { action: string; changes: Record<string, { before: unknown; after: unknown }> }[]
    }

    expect(history.items.map((event) => event.action)).toEqual(['role_changed', 'role_granted', 'updated', 'created'])
    expect(history.items[0]?.changes).toEqual({ role: { before: 'reader', after: 'member' } })
    expect(history.items[2]?.changes).toEqual({ name: { before: 'Produto', after: 'Produto & Design' } })
  })
})
