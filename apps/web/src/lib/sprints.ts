import type { Card, State } from '@/api/requests'
import type { Sprint } from '@/api/sprints'

/**
 * What the screens say about a sprint (ADR-0029): the planning order, its totals, how long it has
 * left. Dates are calendar days in São Paulo, `YYYY-MM-DD`.
 */

const DAY_MS = 86_400_000
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000

/** Today in São Paulo, `YYYY-MM-DD`. */
export const today = (now: Date = new Date()): string =>
  new Date(now.getTime() + SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10)

const _days = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

/** "23/10" from `2026-10-23`. */
export const dayMonth = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`

/** "23/10 a 13/11". */
export const period = (sprint: Pick<Sprint, 'startsOn' | 'endsOn'>): string =>
  `${dayMonth(sprint.startsOn)} a ${dayMonth(sprint.endsOn)}`

/**
 * How long an active sprint has left, or how late it runs.
 *
 * @example remaining({ endsOn: '2026-10-30' }, '2026-10-23')   // { text: '7 dias restantes', late: false }
 */
export const remaining = (sprint: Pick<Sprint, 'endsOn'>, day: string = today()): { text: string; late: boolean } => {
  const left = _days(day, sprint.endsOn)
  if (left < 0) {
    return { text: `Atrasada há ${-left} ${-left === 1 ? 'dia' : 'dias'}`, late: true }
  }
  if (left === 0) {
    return { text: 'Termina hoje', late: false }
  }
  return { text: `${left} ${left === 1 ? 'dia restante' : 'dias restantes'}`, late: false }
}

/** The sprints a backlog plans: the active one first, then the planned ones by number. */
export const planning = (sprints: readonly Sprint[]): Sprint[] => [
  ...sprints.filter((sprint) => sprint.state === 'active'),
  ...sprints.filter((sprint) => sprint.state === 'planned').sort((a, b) => a.number - b.number)
]

export const activeSprint = (sprints: readonly Sprint[]): Sprint | undefined =>
  sprints.find((sprint) => sprint.state === 'active')

/** Cards and points of a set of cards, and how many of them are done — a cancelled card counts for nothing. */
export const tally = (cards: readonly Card[], states: readonly State[]) => {
  const group = (card: Card) => states.find((state) => state.id === card.stateId)?.group
  const counted = cards.filter((card) => group(card) !== 'cancelled')
  return {
    cards: counted.length,
    points: counted.reduce((sum, card) => sum + (card.points ?? 0), 0),
    done: counted.filter((card) => group(card) === 'done').length
  }
}

/** "3 cards · 10 pontos", or only the cards where the space does not estimate in points. */
export const tallyText = (count: { cards: number; points: number }, points: boolean): string => {
  const cards = `${count.cards} ${count.cards === 1 ? 'card' : 'cards'}`
  return points ? `${cards} · ${count.points} ${count.points === 1 ? 'ponto' : 'pontos'}` : cards
}

/** The points a card offers in a space that estimates in them: Jira's scale. */
export const POINTS = [1, 2, 3, 5, 8, 13, 21] as const
