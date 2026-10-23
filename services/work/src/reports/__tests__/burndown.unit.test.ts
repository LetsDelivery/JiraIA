import { describe, expect, it } from 'bun:test'

import { burndown, type CardChange, type CardNow } from '../burndown.js'

const S = 'sprint-1'
const groups = new Map([
  ['todo', 'not_started'],
  ['done', 'done'],
  ['gone', 'cancelled']
])
const sprint = { id: S, startsOn: '2026-10-19', endsOn: '2026-10-23', closedAt: null }
const at = (iso: string) => new Date(iso)
const change = (cardId: string, iso: string, changes: CardChange['changes']): CardChange => ({
  cardId,
  at: at(iso),
  changes
})

describe('a sprint’s burndown', () => {
  it('walks the history back: what was done, when, and what was left each day', () => {
    const cards: CardNow[] = [
      { id: 'a', sprintId: S, stateId: 'done', points: 5 },
      { id: 'b', sprintId: S, stateId: 'todo', points: 3 }
    ]
    // a was done on Tuesday the 20th at 15:00 in São Paulo (18:00 UTC).
    const changes = [change('a', '2026-10-20T18:00:00Z', { stateId: { before: 'todo', after: 'done' } })]
    const days = burndown({ sprint, cards, changes, groups, unit: 'points', now: at('2026-10-21T15:00:00Z') })

    expect(days).toEqual([
      { day: '2026-10-19', remaining: 8, scope: 8 },
      { day: '2026-10-20', remaining: 3, scope: 8 },
      { day: '2026-10-21', remaining: 3, scope: 8 },
      { day: '2026-10-22', remaining: null, scope: null },
      { day: '2026-10-23', remaining: null, scope: null }
    ])
  })

  it('shows scope added mid-sprint as a step, and counts cards where the space uses no points', () => {
    const cards: CardNow[] = [
      { id: 'a', sprintId: S, stateId: 'todo', points: null },
      { id: 'b', sprintId: S, stateId: 'todo', points: null }
    ]
    const changes = [change('b', '2026-10-20T13:00:00Z', { sprintId: { before: null, after: S } })]
    const days = burndown({ sprint, cards, changes, groups, unit: 'cards', now: at('2026-10-20T20:00:00Z') })

    expect(days.slice(0, 2)).toEqual([
      { day: '2026-10-19', remaining: 1, scope: 1 },
      { day: '2026-10-20', remaining: 2, scope: 2 }
    ])
  })

  it('stops a closed sprint just before its close carried the open cards away', () => {
    const closed = { ...sprint, closedAt: at('2026-10-23T20:00:00Z') }
    const cards: CardNow[] = [{ id: 'a', sprintId: 'sprint-2', stateId: 'todo', points: 2 }]
    const changes = [change('a', '2026-10-23T20:00:00Z', { sprintId: { before: S, after: 'sprint-2' } })]
    const days = burndown({ sprint: closed, cards, changes, groups, unit: 'points', now: at('2026-10-30T12:00:00Z') })

    expect(days.at(-1)).toEqual({ day: '2026-10-23', remaining: 2, scope: 2 })
  })

  it('runs past its end date while the sprint is late, and leaves the cancelled out', () => {
    const cards: CardNow[] = [
      { id: 'a', sprintId: S, stateId: 'todo', points: 1 },
      { id: 'b', sprintId: S, stateId: 'gone', points: 8 }
    ]
    const days = burndown({ sprint, cards, changes: [], groups, unit: 'points', now: at('2026-10-25T12:00:00Z') })

    expect(days.map((each) => each.day).at(-1)).toBe('2026-10-25')
    expect(days.at(-1)).toEqual({ day: '2026-10-25', remaining: 1, scope: 1 })
  })
})
