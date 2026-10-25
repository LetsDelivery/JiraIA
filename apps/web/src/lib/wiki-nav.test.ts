import { describe, expect, it } from 'vitest'

import {
  childrenOf,
  filtering,
  filterPages,
  firstRoots,
  matchesName,
  ownersLabel,
  relativeTime,
  sliceSection,
  subpageCounts,
  threadKind
} from './wiki-nav'

const now = new Date('2026-10-24T15:00:00.000Z') // 12:00 in São Paulo

describe('relative time', () => {
  it('says agora, minutes and hours within the same day', () => {
    expect(relativeTime('2026-10-24T14:59:30.000Z', now)).toBe('agora')
    expect(relativeTime('2026-10-24T14:59:00.000Z', now)).toBe('há 1 minuto')
    expect(relativeTime('2026-10-24T14:35:00.000Z', now)).toBe('há 25 minutos')
    expect(relativeTime('2026-10-24T13:00:00.000Z', now)).toBe('há 2 horas')
  })

  it('counts days on São Paulo’s calendar, not UTC’s', () => {
    // 01:00 UTC on the 24th is still the 23rd in São Paulo: yesterday there.
    expect(relativeTime('2026-10-24T01:00:00.000Z', now)).toBe('ontem')
    expect(relativeTime('2026-10-19T15:00:00.000Z', now)).toBe('há 5 dias')
  })

  it('gives the date past a week, and never a time in the future', () => {
    expect(relativeTime('2026-10-01T15:00:00.000Z', now)).toBe('01/10/2026')
    expect(relativeTime('2026-10-24T15:05:00.000Z', now)).toBe('agora')
  })
})

const tree = [
  { id: 'a', parentId: null, position: 1 },
  { id: 'b', parentId: 'a', position: 0 },
  { id: 'c', parentId: 'b', position: 0 },
  { id: 'd', parentId: null, position: 0 },
  { id: 'e', parentId: 'a', position: 1 }
]

describe('a collection’s tree', () => {
  it('counts the pages under each page, at any depth', () => {
    const counts = subpageCounts(tree)
    expect(counts.get('a')).toBe(3)
    expect(counts.get('b')).toBe(1)
    expect(counts.has('d')).toBe(false)
  })

  it('lists a level in its order', () => {
    expect(childrenOf(tree, null).map((node) => node.id)).toEqual(['d', 'a'])
    expect(childrenOf(tree, 'a').map((node) => node.id)).toEqual(['b', 'e'])
  })

  it('cuts a tree to its first top-level pages, keeping what is under them', () => {
    expect(firstRoots(tree, 1).map((node) => node.id)).toEqual(['d'])
    expect(
      firstRoots(tree, 2)
        .map((node) => node.id)
        .sort()
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('a sidebar section', () => {
  it('shows eight and keeps the rest behind "Ver todas"', () => {
    const items = Array.from({ length: 11 }, (_, index) => index)
    expect(sliceSection(items)).toEqual({ shown: [0, 1, 2, 3, 4, 5, 6, 7], rest: [8, 9, 10] })
    expect(sliceSection([1, 2])).toEqual({ shown: [1, 2], rest: [] })
  })
})

const page = (
  title: string,
  extra: Partial<{ state: 'draft' | 'official'; overdue: boolean; owner: string }> = {}
) => ({
  title,
  kind: 'page',
  state: extra.state ?? 'draft',
  overdue: extra.overdue ?? false,
  owner: { id: extra.owner ?? 'ana' }
})

describe('the collection’s filter', () => {
  const pages = [
    page('Operação'),
    page('Contratos', { state: 'official', owner: 'bia' }),
    page('Velha', { state: 'official', overdue: true }),
    { ...page('Pasta'), kind: 'folder' }
  ]

  it('finds titles without minding case or accents', () => {
    expect(matchesName('Operação São Paulo', 'operacao sao')).toBe(true)
    expect(filterPages(pages, { text: 'OPERA', state: 'all' }).map((each) => each.title)).toEqual(['Operação'])
  })

  it('keeps a state, or only the caller’s pages, and drops folders', () => {
    expect(filterPages(pages, { text: '', state: 'official' }).map((each) => each.title)).toEqual([
      'Contratos',
      'Velha'
    ])
    expect(filterPages(pages, { text: '', state: 'overdue' }).map((each) => each.title)).toEqual(['Velha'])
    expect(filterPages(pages, { text: '', state: 'all', ownerId: 'bia' }).map((each) => each.title)).toEqual([
      'Contratos'
    ])
  })

  it('knows when it is doing anything', () => {
    expect(filtering({ text: ' ', state: 'all' })).toBe(false)
    expect(filtering({ text: '', state: 'draft' })).toBe(true)
    expect(filtering({ text: '', state: 'all', ownerId: 'ana' })).toBe(true)
  })
})

describe('labels', () => {
  it('names the first owner and counts the others', () => {
    expect(ownersLabel([])).toBe('—')
    expect(ownersLabel([{ name: 'Ana' }])).toBe('Ana')
    expect(ownersLabel([{ name: 'Ana' }, { name: 'Bia' }, { name: 'Caio' }])).toBe('Ana +2')
  })

  it('tells a page’s comment from one held to its text', () => {
    expect(threadKind({ anchorId: null })).toBe('page')
    expect(threadKind({ anchorId: 'x' })).toBe('inline')
  })
})
