import { describe, expect, it } from 'vitest'

import { endOfDayInSaoPaulo, isOpen, waitsOnMe } from './governance'

describe('endOfDayInSaoPaulo', () => {
  it('ends the day in São Paulo, which is already the next day in UTC', () => {
    expect(endOfDayInSaoPaulo('2026-11-30')).toBe('2026-12-01T02:59:59.000Z')
  })
})

describe('waitsOnMe', () => {
  it('is true when the caller decides or carries out the request', () => {
    expect(waitsOnMe({ canDecide: false, canComplete: true })).toBe(true)
    expect(waitsOnMe({ canDecide: false, canComplete: false })).toBe(false)
  })
})

describe('isOpen', () => {
  it('is open until done, declined or cancelled', () => {
    expect(isOpen({ status: 'approved' })).toBe(true)
    expect(isOpen({ status: 'done' })).toBe(false)
  })
})
