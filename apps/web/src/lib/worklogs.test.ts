import { describe, expect, it } from 'vitest'

import { duration } from './worklogs'

describe('logged time', () => {
  it('reads as hours and minutes', () => {
    expect(duration(9000)).toBe('2h 30min')
    expect(duration(2700)).toBe('45min')
    expect(duration(10800)).toBe('3h')
    expect(duration(0)).toBe('0min')
  })
})
