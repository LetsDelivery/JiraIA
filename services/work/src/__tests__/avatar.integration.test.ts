import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { eq } from 'drizzle-orm'

import { buildService } from '../container.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { auditEvents } from '../schema.js'

/** A person's photo (ADR-0039): uploaded straight to storage, shown on every member list. */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Member = { id: string; avatarUrl: string | null }
type Started = { id: string; upload: { url: string } }

let service: ReturnType<typeof buildService>
let files: InMemoryFileStore

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const photo = { contentType: 'image/webp', size: 4000 }

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

/** What the browser does: announce, `PUT` the bytes, confirm. */
const upload = async (size = photo.size) => {
  const started = (await ok(admin({ method: 'POST', path: '/me/avatar', body: photo }), 201)) as Started
  const key = started.upload.url.replace('https://files.counterparty.test/', '')
  await files.put(key, size)
  const complete = () => admin({ method: 'POST', path: `/me/avatar/${started.id}/complete`, body: photo })
  return { key, complete }
}

const actions = async () =>
  (await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityType, 'member')))
    .map((row) => row.action)
    .filter((action) => action.startsWith('avatar_'))

beforeEach(async () => {
  await truncateSchema(db, 'work')
  files = new InMemoryFileStore()
  service = buildService(config, { db, files })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
})

describe('a member photo', () => {
  it('starts without one, so the panel draws initials', async () => {
    expect(((await ok(admin({ method: 'GET', path: '/me' }))) as Member).avatarUrl).toBeNull()
  })

  it('is shown on /me and on the member list once uploaded, and audited', async () => {
    const { key, complete } = await upload()
    const me = (await ok(complete())) as Member

    expect(key).toMatch(new RegExp(`/avatars/${me.id}/[0-9a-f-]+\\.webp$`))
    expect(me.avatarUrl).toBe(`https://files.counterparty.test/${key}?view`)
    const list = (await ok(admin({ method: 'GET', path: '/members' }))) as { items: Member[] }
    expect(list.items.find((member) => member.id === me.id)?.avatarUrl).toBe(me.avatarUrl)
    expect(await actions()).toEqual(['avatar_changed'])
  })

  it('is refused while the bytes announced have not arrived', async () => {
    const { complete } = await upload(10)
    expect((await complete()).status).toBe(409)
    expect(((await ok(admin({ method: 'GET', path: '/me' }))) as Member).avatarUrl).toBeNull()
  })

  it('replaces the previous photo and deletes its file', async () => {
    const first = await upload()
    await ok(first.complete())
    const second = await upload()
    await ok(second.complete())

    expect(files.sizes.has(first.key)).toBe(false)
    expect(files.sizes.has(second.key)).toBe(true)
  })

  it('is removed back to the initials, and its file with it', async () => {
    const { key, complete } = await upload()
    await ok(complete())
    const me = (await ok(admin({ method: 'DELETE', path: '/me/avatar' }))) as Member

    expect(me.avatarUrl).toBeNull()
    expect(files.sizes.has(key)).toBe(false)
    expect(await actions()).toEqual(['avatar_changed', 'avatar_removed'])
  })

  it('accepts only small pictures', async () => {
    const pdf = await admin({ method: 'POST', path: '/me/avatar', body: { contentType: 'application/pdf', size: 10 } })
    const huge = await admin({ method: 'POST', path: '/me/avatar', body: { ...photo, size: 50 * 1024 * 1024 } })
    expect([pdf.status, huge.status]).toEqual([400, 400])
  })
})
