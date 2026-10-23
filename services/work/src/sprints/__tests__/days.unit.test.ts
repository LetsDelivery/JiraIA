import { describe, expect, it } from 'bun:test'

import { addDays, daysBetween, saoPauloDay } from '../days.js'

describe('a sprint’s calendar days', () => {
  it('reads the day in São Paulo, three hours behind UTC', () => {
    expect(saoPauloDay(new Date('2026-10-24T02:59:00Z'))).toBe('2026-10-23')
    expect(saoPauloDay(new Date('2026-10-24T03:00:00Z'))).toBe('2026-10-24')
  })

  it('moves across months and years, and counts the days between', () => {
    expect(addDays('2026-10-16', 1)).toBe('2026-10-17')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-09-28', '2026-10-16')).toBe(18)
    expect(daysBetween('2026-10-16', '2026-10-16')).toBe(0)
  })
})
