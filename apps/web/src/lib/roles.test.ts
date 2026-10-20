import { describe, expect, it } from 'vitest'

import { canWriteIn } from './roles'

describe('roles', () => {
  it('lets admins and members write, and an organization admin anywhere', () => {
    expect(canWriteIn(false, 'member')).toBe(true)
    expect(canWriteIn(false, 'reader')).toBe(false)
    expect(canWriteIn(false, undefined)).toBe(false)
    expect(canWriteIn(true, undefined)).toBe(true)
  })
})
