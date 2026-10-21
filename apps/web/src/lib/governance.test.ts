import { describe, expect, it } from 'vitest'

import { endOfDayInSaoPaulo, inventoryRows, isLate, isOpen, quarterOf, waitsOnMe } from './governance'

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

describe('isLate', () => {
  const now = new Date('2026-10-27T12:00:00.000Z')

  it('flags an open request past its deadline, and one the record says was breached', () => {
    expect(isLate({ overdue: false, dueAt: '2026-10-26T18:00:00.000Z', status: 'approved' }, now)).toBe(true)
    expect(isLate({ overdue: true, dueAt: '2026-10-26T18:00:00.000Z', status: 'done' }, now)).toBe(true)
  })

  it('leaves alone what is on time, and what was closed on time', () => {
    expect(isLate({ overdue: false, dueAt: '2026-10-28T18:00:00.000Z', status: 'approved' }, now)).toBe(false)
    expect(isLate({ overdue: false, dueAt: '2026-10-26T18:00:00.000Z', status: 'done' }, now)).toBe(false)
  })
})

describe('inventoryRows', () => {
  it('reads the columns by name, in any order, with dates written either way', () => {
    expect(
      inventoryRows([
        ['Perfil', 'E-mail', 'Sistema', 'Validade', 'ignorada'],
        ['Leitura', 'ana@uselets.com', 'AWS', '30/11/2026', 'x'],
        ['Admin', 'gil@uselets.com', 'AWS', '', '']
      ])
    ).toEqual([
      { profile: 'Leitura', email: 'ana@uselets.com', system: 'AWS', expiresAt: '2026-11-30' },
      { profile: 'Admin', email: 'gil@uselets.com', system: 'AWS' }
    ])
  })
})

describe('quarterOf', () => {
  it('spans the quarter a day falls in', () => {
    expect(quarterOf('2026-10-21')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(quarterOf('2028-02-10')).toEqual({ from: '2028-01-01', to: '2028-03-31' })
  })
})
