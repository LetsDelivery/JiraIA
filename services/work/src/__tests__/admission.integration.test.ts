import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Who gets in with a Google ID token (ADR-0005): a verified address of the Workspace domain, and
 * nobody else — whatever the address looks like.
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

const call = async (claims: Record<string, string>, input: Omit<Call, 'subject' | 'claims'>) =>
  answer(await service.router(apiEvent({ ...input, claims })))
const me = (claims: Record<string, string>) => call(claims, { method: 'GET', path: '/me' })
const admin = (input: Omit<Call, 'subject' | 'claims'>) => call(googleClaims('admin@uselets.com'), input)

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "Let's", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
})

describe('first sign-in', () => {
  it('admits anyone of the domain as a member with no roles, who reads every space (ADR-0012)', async () => {
    const admin = await call(googleClaims('admin@uselets.com'), {
      method: 'POST',
      path: '/spaces',
      body: { key: 'PRD', name: 'Produto', type: 'business' }
    })
    expect(admin.status).toBe(201)

    const joined = await me({ ...googleClaims('nova@uselets.com'), name: 'Nova Pessoa' })
    const spaces = await call(googleClaims('nova@uselets.com'), { method: 'GET', path: '/spaces' })

    expect(joined).toMatchObject({
      status: 200,
      body: { email: 'nova@uselets.com', name: 'Nova Pessoa', isOrgAdmin: false }
    })
    expect(spaces.body).toMatchObject({ items: [{ key: 'PRD' }] })
  })

  it('names a member who joined without a name claim after their address', async () => {
    expect((await me(googleClaims('rui.silva@uselets.com'))).body).toMatchObject({ name: 'rui.silva' })
  })

  it('recognises the bootstrapped admin by address and keeps them admin', async () => {
    expect((await me(googleClaims('admin@uselets.com'))).body).toMatchObject({ isOrgAdmin: true })
  })

  it('recognises an invited member by address and keeps the roles given before they signed in', async () => {
    const space = (
      await admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Produto', type: 'business' } })
    ).body as { id: string }
    const ana = (await admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }))
      .body as { id: string }
    await admin({ method: 'PUT', path: `/spaces/${space.id}/members/${ana.id}`, body: { role: 'member' } })

    const signedIn = await me(googleClaims('ana@uselets.com'))
    const spaces = await call(googleClaims('ana@uselets.com'), { method: 'GET', path: '/spaces' })

    expect(signedIn.body).toMatchObject({ id: ana.id })
    expect(spaces.body).toMatchObject({ items: [{ id: space.id }] })
  })

  it('admits one member when the panel fires several first requests at once', async () => {
    const answers = await Promise.all(Array.from({ length: 5 }, () => me(googleClaims('nova@uselets.com'))))
    const members = (await admin({ method: 'GET', path: '/members' })).body as { items: { email: string }[] }

    expect(answers.map((each) => each.status)).toEqual([200, 200, 200, 200, 200])
    expect(members.items.filter((member) => member.email === 'nova@uselets.com')).toHaveLength(1)
  })
})

describe('refusals', () => {
  it('refuses an address of another domain', async () => {
    const refused = await me(googleClaims('alguem@gmail.com'))

    expect(refused).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } })
  })

  it('refuses a consumer Google account that merely uses an address of the domain', async () => {
    const { hd: _workspace, ...consumer } = googleClaims('intruso@uselets.com')

    expect((await me(consumer)).status).toBe(403)
  })

  it('refuses an address Google has not verified', async () => {
    expect((await me(googleClaims('ana@uselets.com', { email_verified: 'false' }))).status).toBe(403)
  })

  it('refuses a Workspace account whose address is of another domain', async () => {
    expect((await me(googleClaims('ana@outra.com', { hd: 'uselets.com' }))).status).toBe(403)
  })

  it('refuses a second Google account claiming an address already bound to another', async () => {
    await me(googleClaims('ana@uselets.com'))

    expect((await me(googleClaims('ana@uselets.com', { sub: 'google:another-account' }))).status).toBe(403)
  })

  it('refuses an invited member who was deactivated before their first sign-in', async () => {
    const ana = (await admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }))
      .body as { id: string }
    await admin({ method: 'POST', path: `/members/${ana.id}/deactivate` })

    expect((await me(googleClaims('ana@uselets.com'))).status).toBe(403)
  })

  it('refuses inviting an address that could never sign in', async () => {
    const refused = await admin({ method: 'POST', path: '/members', body: { email: 'ana@gmail.com', name: 'Ana' } })

    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } })
  })
})
