import { describe, expect, it } from 'vitest'

import { dayMonth, isoDate, isPast, monthGrid, monthLabel, shiftMonth, shortDate, todayInSaoPaulo } from './dates'

describe('dates', () => {
  it('lays a month out in whole weeks from Sunday', () => {
    const november = monthGrid({ year: 2026, month: 10 })
    expect(november[0]).toBe('2026-11-01')
    expect(november).toHaveLength(35)
    expect(monthGrid({ year: 2026, month: 9 })[0]).toBe('2026-09-27')
  })

  it('rolls months and days over the year', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(isoDate(2026, 0, 0)).toBe('2025-12-31')
    expect(monthLabel({ year: 2026, month: 10 })).toBe('novembro de 2026')
  })

  it('takes today in São Paulo, a day behind UTC late in the evening', () => {
    expect(todayInSaoPaulo(new Date('2026-11-30T01:30:00Z'))).toBe('2026-11-29')
    expect(shortDate('2026-11-30')).toBe('30/11/2026')
    expect(shortDate(null)).toBe('—')
  })

  it('shortens a due date for a tile and tells when it has passed', () => {
    expect(dayMonth('2026-11-02')).toBe('2 nov')
    expect(dayMonth('2026-03-30')).toBe('30 mar')
    expect(isPast('2026-10-22', '2026-10-23')).toBe(true)
    expect(isPast('2026-10-23', '2026-10-23')).toBe(false)
  })
})
