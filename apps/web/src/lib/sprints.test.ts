import { describe, expect, it } from 'vitest'

import type { Card, State } from '@/api/requests'
import type { Sprint } from '@/api/sprints'

import { period, planning, remaining, tally, tallyText, today } from './sprints'

const sprint = (number: number, state: string): Sprint =>
  ({ id: `s${number}`, number, state, startsOn: '2026-10-23', endsOn: '2026-11-13' }) as Sprint

describe('a sprint on screen', () => {
  it('says how long it has left, the day it ends, and how late it runs', () => {
    expect(remaining({ endsOn: '2026-10-30' }, '2026-10-23')).toEqual({ text: '7 dias restantes', late: false })
    expect(remaining({ endsOn: '2026-10-24' }, '2026-10-23').text).toBe('1 dia restante')
    expect(remaining({ endsOn: '2026-10-23' }, '2026-10-23').text).toBe('Termina hoje')
    expect(remaining({ endsOn: '2026-10-16' }, '2026-10-23')).toEqual({ text: 'Atrasada há 7 dias', late: true })
  })

  it('reads today and the period in São Paulo', () => {
    expect(today(new Date('2026-10-24T02:00:00Z'))).toBe('2026-10-23')
    expect(period({ startsOn: '2026-10-23', endsOn: '2026-11-13' })).toBe('23/10 a 13/11')
  })

  it('plans the active sprint first, then the planned ones by number, and leaves the closed out', () => {
    const order = planning([sprint(3, 'planned'), sprint(1, 'closed'), sprint(4, 'planned'), sprint(2, 'active')])
    expect(order.map((each) => each.number)).toEqual([2, 3, 4])
  })

  it('adds cards and points, counts the done, and ignores the cancelled', () => {
    const states = [
      { id: 'todo', group: 'not_started' },
      { id: 'done', group: 'done' },
      { id: 'gone', group: 'cancelled' }
    ] as State[]
    const cards = [
      { stateId: 'todo', points: 3 },
      { stateId: 'done', points: 5 },
      { stateId: 'gone', points: 8 },
      { stateId: 'todo', points: null }
    ] as Card[]
    expect(tally(cards, states)).toEqual({ cards: 3, points: 8, done: 1 })
    expect(tallyText({ cards: 3, points: 8 }, true)).toBe('3 cards · 8 pontos')
    expect(tallyText({ cards: 1, points: 0 }, false)).toBe('1 card')
  })
})
