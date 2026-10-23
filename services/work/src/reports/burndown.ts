import { addDays, daysBetween, saoPauloDay } from '../sprints/days.js'

/**
 * A sprint's burndown, read back from the audit trail (ADR-0016, ADR-0029). Each card's sprint, state
 * and points are known now; walking its changes backwards gives what they were at the end of every
 * day of the sprint, in São Paulo. What is left is what was in the sprint and not done or cancelled.
 */

/** What a card is now: the values the walk starts from. */
export type CardNow = { id: string; sprintId: string | null; stateId: string; points: number | null }

/** One line of a card's history that touched what the burndown reads. */
export type CardChange = { cardId: string; at: Date; changes: Record<string, { before: unknown; after: unknown }> }

export type BurndownSprint = { id: string; startsOn: string; endsOn: string; closedAt: Date | null }

export type BurndownDay = { day: string; remaining: number | null; scope: number | null }

type Input = {
  sprint: BurndownSprint
  cards: readonly CardNow[]
  changes: readonly CardChange[]
  /** Each state's group: done and cancelled are no longer remaining. */
  groups: ReadonlyMap<string, string>
  unit: 'points' | 'cards'
  now: Date
}

const FIELDS = ['sprintId', 'stateId', 'points'] as const

/** The instant a day ends in São Paulo: the next day's 03:00 UTC. */
const _endOf = (day: string): number => Date.parse(`${addDays(day, 1)}T03:00:00.000Z`)

/** The last day there is something to show: the day it closed, or today; at least its start. */
const _lastShown = (sprint: BurndownSprint, now: Date): string => saoPauloDay(sprint.closedAt ?? now)

/** Undoes one change on the card it touched: each field it changed goes back to its `before`. */
const _undo = (state: Map<string, CardNow>, change: CardChange): void => {
  const card = state.get(change.cardId)
  if (!card) {
    return
  }
  const back = { ...card }
  for (const field of FIELDS) {
    const each = change.changes[field]
    if (each) {
      Object.assign(back, { [field]: each.before ?? null })
    }
  }
  state.set(card.id, back)
}

/** What one card weighs in the sprint as it was: nothing outside it or cancelled, nothing left once done. */
const _weight = (card: CardNow, input: Input): { remaining: number; scope: number } => {
  const group = input.groups.get(card.stateId)
  if (card.sprintId !== input.sprint.id || group === 'cancelled') {
    return { remaining: 0, scope: 0 }
  }
  const value = input.unit === 'points' ? (card.points ?? 0) : 1
  return { remaining: group === 'done' ? 0 : value, scope: value }
}

/** Remaining and scope of the sprint for cards as they were. */
const _tally = (cards: Iterable<CardNow>, input: Input): { remaining: number; scope: number } => {
  const total = { remaining: 0, scope: 0 }
  for (const card of cards) {
    const weight = _weight(card, input)
    total.remaining += weight.remaining
    total.scope += weight.scope
  }
  return total
}

/** The sprint's days, from its start to its end — or to its last shown day, when it ran late. */
const _days = (input: Input, last: string): string[] => {
  const end = daysBetween(input.sprint.endsOn, last) > 0 ? last : input.sprint.endsOn
  return Array.from({ length: daysBetween(input.sprint.startsOn, end) + 1 }, (_, n) =>
    addDays(input.sprint.startsOn, n)
  )
}

/** Walks back from now, day by day, undoing what happened after each day ended. */
const _walk = (input: Input, days: readonly string[]): Map<string, { remaining: number; scope: number }> => {
  const state = new Map(input.cards.map((card) => [card.id, card]))
  const newestFirst = [...input.changes].sort((a, b) => b.at.getTime() - a.at.getTime())
  const closing = input.sprint.closedAt ? input.sprint.closedAt.getTime() - 1 : Number.POSITIVE_INFINITY
  const shown = new Map<string, { remaining: number; scope: number }>()
  let next = 0
  for (const day of [...days].reverse()) {
    const boundary = Math.min(_endOf(day), closing)
    for (; next < newestFirst.length && (newestFirst[next] as CardChange).at.getTime() > boundary; next += 1) {
      _undo(state, newestFirst[next] as CardChange)
    }
    shown.set(day, _tally(state.values(), input))
  }
  return shown
}

/**
 * Every day from the sprint's start to its end — or to today, when it runs late — with what was left
 * at the end of it. Days still ahead carry `null`.
 */
export const burndown = (input: Input): BurndownDay[] => {
  const last = _lastShown(input.sprint, input.now)
  const days = _days(input, last)
  const shown = _walk(
    input,
    days.filter((day) => daysBetween(day, last) >= 0)
  )
  return days.map((day) => ({
    day,
    remaining: shown.get(day)?.remaining ?? null,
    scope: shown.get(day)?.scope ?? null
  }))
}
