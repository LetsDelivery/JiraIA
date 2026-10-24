import { describe, expect, it } from 'vitest'

import { collectionPath, contentPathIn, dayOf, pageMark, pathsIn, wikiPagePath } from './wiki'

const now = new Date('2026-10-24T12:00:00.000Z')

describe('LET’S Wiki addresses', () => {
  it('puts a collection and its pages under /wiki, by id', () => {
    expect(collectionPath('c1')).toBe('/wiki/c1')
    expect(wikiPagePath('c1', 'p1')).toBe('/wiki/c1/p1')
  })

  it('opens a search result in the product it belongs to', () => {
    expect(contentPathIn('wiki', 'c1', 'p1')).toBe('/wiki/c1/p1')
    expect(contentPathIn('draw', 's1', 'p1')).toBe('/draw/s1/p1')
  })

  it('gives each product its own addresses, Draw by default', () => {
    expect(pathsIn('wiki').space('c1')).toBe('/wiki/c1')
    expect(pathsIn().content('s1', 'p1')).toBe('/draw/s1/p1')
  })
})

describe('a page’s mark', () => {
  it('says draft, official, due soon or overdue', () => {
    expect(pageMark({ state: 'draft', reviewDue: null, overdue: false }, now)).toEqual({
      tone: 'draft',
      label: 'Rascunho'
    })
    expect(pageMark({ state: 'official', reviewDue: '2027-01-22T12:00:00.000Z', overdue: false }, now).tone).toBe(
      'official'
    )
    expect(pageMark({ state: 'official', reviewDue: '2026-11-01T12:00:00.000Z', overdue: false }, now)).toEqual({
      tone: 'due',
      label: 'Revisar até 01/11/2026'
    })
    expect(pageMark({ state: 'official', reviewDue: '2026-10-01T12:00:00.000Z', overdue: true }, now).label).toBe(
      'Revisão vencida'
    )
  })

  it('dates the review in São Paulo, not UTC', () => {
    expect(dayOf('2026-11-01T02:00:00.000Z')).toBe('31/10/2026')
  })
})
