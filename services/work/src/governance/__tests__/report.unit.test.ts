import { describe, expect, it } from 'bun:test'

import { onTime } from '../report.js'

const due = new Date('2026-10-27T18:00:00.000Z')

describe('onTime', () => {
  it('is done by the deadline and never found late', () => {
    expect(onTime({ dueAt: due, completedAt: new Date('2026-10-27T17:00:00.000Z'), overdueAt: null })).toBe(true)
  })

  it('is not when done after the deadline, or once found late', () => {
    expect(onTime({ dueAt: due, completedAt: new Date('2026-10-28T09:00:00.000Z'), overdueAt: null })).toBe(false)
    expect(onTime({ dueAt: due, completedAt: due, overdueAt: due })).toBe(false)
  })

  it('counts a request with no deadline as on time', () => {
    expect(onTime({ dueAt: null, completedAt: due, overdueAt: null })).toBe(true)
  })
})
