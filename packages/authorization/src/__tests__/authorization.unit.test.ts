import { describe, expect, it } from 'bun:test'

import { ForbiddenException } from '@jiraia/core'

import { type Access, type Action, assertCan, can, type Role, strongest } from '../index.js'

const access = (overrides: Partial<Access> = {}): Access => ({ active: true, isOrgAdmin: false, ...overrides })

/** The matrix written out, so a change to a rule is a change to this table first. */
const MATRIX: Record<Role, Record<Action, boolean>> = {
  admin: { 'space:read': true, 'space:write': true, 'space:manage': true },
  member: { 'space:read': true, 'space:write': true, 'space:manage': false },
  reader: { 'space:read': true, 'space:write': false, 'space:manage': false }
}

describe('can, from the space role', () => {
  for (const [role, actions] of Object.entries(MATRIX)) {
    for (const [action, expected] of Object.entries(actions)) {
      it(`${role} ${expected ? 'may' : 'may not'} ${action}`, () => {
        expect(can(access({ spaceRole: role as Role }), action as Action)).toBe(expected)
      })
    }
  }
})

describe('can, for whoever holds no role', () => {
  it('refuses everything to a member of the organization with no role in the space', () => {
    for (const action of Object.keys(MATRIX.admin) as Action[]) {
      expect(can(access(), action)).toBe(false)
    }
  })

  it('allows everything to an organization admin', () => {
    expect(can(access({ isOrgAdmin: true }), 'space:manage')).toBe(true)
  })

  it('refuses everything to a deactivated member, even an organization admin', () => {
    expect(can(access({ active: false, isOrgAdmin: true, spaceRole: 'admin' }), 'space:read')).toBe(false)
  })
})

describe('assertCan', () => {
  it('throws a 403 that names the action and the role held', () => {
    try {
      assertCan(access({ spaceRole: 'reader' }), 'space:manage', { spaceId: 's-1' })
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException)
      expect((error as ForbiddenException).details).toEqual({
        action: 'space:manage',
        spaceRole: 'reader',
        spaceId: 's-1'
      })
    }
  })
})

describe('the effective role', () => {
  it('is the strongest of what a member holds, from any source', () => {
    expect(strongest(['reader', 'member', undefined])).toBe('member')
    expect(strongest(['reader', 'admin', 'member'])).toBe('admin')
    expect(strongest([undefined])).toBeUndefined()
  })
})
