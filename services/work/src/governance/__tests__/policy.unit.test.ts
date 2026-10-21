import { describe, expect, it } from 'bun:test'

import type { Duty } from '../catalog.schemas.js'
import { abilitiesOf, expiryOf, type Governor, scopeOf } from '../policy.js'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString()

const governor = (duties: Record<string, Duty[]> = {}, flags: Partial<Governor> = {}): Governor => ({
  id: 'me',
  isOrgAdmin: false,
  isAccessAuditor: false,
  duties: new Map(Object.entries(duties).map(([system, each]) => [system, new Set(each)])),
  ...flags
})

const request = (fields: Partial<{ status: string; requesterId: string; beneficiaryId: string }> = {}) => ({
  systemId: 'aws',
  status: 'requested',
  requesterId: 'ana',
  beneficiaryId: 'ana',
  ...fields
})

describe('expiryOf', () => {
  it('requires an expiry for a privileged profile', () => {
    expect(() => expiryOf('privileged', undefined, NOW)).toThrow('needs an expiry date')
  })

  it('refuses a privileged expiry more than 90 days ahead, and accepts one at 90', () => {
    expect(() => expiryOf('privileged', days(91), NOW)).toThrow('more than 90 days ahead')
    expect(expiryOf('privileged', days(90), NOW)?.toISOString()).toBe(days(90))
  })

  it('refuses an expiry in the past, and lets a standard profile have none', () => {
    expect(() => expiryOf('standard', days(-1), NOW)).toThrow('is not in the future')
    expect(expiryOf('standard', undefined, NOW)).toBeNull()
  })
})

describe('abilitiesOf', () => {
  it('lets an owner decide a request that does not name them', () => {
    expect(abilitiesOf(governor({ aws: ['owner'] }), request()).canDecide).toBe(true)
  })

  it('never lets anyone decide or carry out a request that names them, admins included', () => {
    const admin = governor({}, { id: 'ana', isOrgAdmin: true })
    expect(abilitiesOf(admin, request()).canDecide).toBe(false)
    expect(abilitiesOf(admin, request({ status: 'approved' })).canComplete).toBe(false)
  })

  it('lets an operator carry out only what is approved, and not decide it', () => {
    const operator = governor({ aws: ['operator'] })
    expect(abilitiesOf(operator, request()).canComplete).toBe(false)
    expect(abilitiesOf(operator, request({ status: 'approved' }))).toMatchObject({
      canComplete: true,
      canDecide: false
    })
  })

  it('lets whom a request names cancel it while open, and nobody after it is done', () => {
    expect(abilitiesOf(governor({}, { id: 'ana' }), request()).canCancel).toBe(true)
    expect(abilitiesOf(governor({}, { id: 'ana' }), request({ status: 'done' })).canCancel).toBe(false)
    expect(abilitiesOf(governor({ aws: ['owner'] }), request()).canCancel).toBe(false)
  })
})

describe('scopeOf', () => {
  it('shows everything to an auditor, and to anyone else their own and their systems', () => {
    expect(scopeOf(governor({}, { isAccessAuditor: true }))).toEqual({ all: true })
    expect(scopeOf(governor({ aws: ['operator'] }))).toEqual({ all: false, memberId: 'me', systemIds: ['aws'] })
  })
})
