import { describe, expect, it } from 'bun:test'

import { addBusinessDays, addHours, easter, isBusinessDay, nationalHolidays } from '../calendar.js'

const NONE = new Set<string>()

describe('easter', () => {
  it('falls where the calendar says', () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe('2026-04-05')
    expect(easter(2027).toISOString().slice(0, 10)).toBe('2027-03-28')
  })
})

describe('nationalHolidays', () => {
  it('holds the fixed days, Carnival, Good Friday and Corpus Christi of 2026', () => {
    expect(nationalHolidays(2026)).toEqual(
      expect.arrayContaining(['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20', '2026-12-25'])
    )
  })
})

describe('isBusinessDay', () => {
  it('skips weekends, national holidays and the organization’s own', () => {
    expect(isBusinessDay('2026-10-21', NONE)).toBe(true)
    expect(isBusinessDay('2026-10-24', NONE)).toBe(false)
    expect(isBusinessDay('2026-11-02', NONE)).toBe(false)
    expect(isBusinessDay('2026-01-25', new Set(['2026-01-25']))).toBe(false)
  })
})

describe('addBusinessDays', () => {
  it('keeps the São Paulo time of day and jumps the weekend', () => {
    // Friday 2026-10-23 15:00 in São Paulo is 18:00 UTC.
    expect(addBusinessDays(new Date('2026-10-23T18:00:00.000Z'), 2, NONE).toISOString()).toBe(
      '2026-10-27T18:00:00.000Z'
    )
  })

  it('jumps a holiday between', () => {
    // Friday 2026-10-30 → Monday 11-02 is Finados → Tuesday 11-03, Wednesday 11-04.
    expect(addBusinessDays(new Date('2026-10-30T18:00:00.000Z'), 2, NONE).toISOString()).toBe(
      '2026-11-04T18:00:00.000Z'
    )
  })

  it('counts by the São Paulo day, not the UTC one', () => {
    // Friday 22:00 in São Paulo is already Saturday in UTC; one business day is Monday 22:00.
    expect(addBusinessDays(new Date('2026-10-24T01:00:00.000Z'), 1, NONE).toISOString()).toBe(
      '2026-10-27T01:00:00.000Z'
    )
  })
})

describe('addHours', () => {
  it('counts hours by the clock, weekends included', () => {
    expect(addHours(new Date('2026-10-24T12:00:00.000Z'), 24).toISOString()).toBe('2026-10-25T12:00:00.000Z')
  })
})
