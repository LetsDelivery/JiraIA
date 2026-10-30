import type { CardFilter } from './filters'
import { withParams } from './filters'

/**
 * The Lista leaves out the cards done long ago (ADR-0040): a done card shows only if it entered a done
 * state in the last `OLD_DONE_DAYS`. Nothing is archived — `?concluidos=todos` shows them all again, and
 * a filter that names states is the person asking for them, so it is left alone.
 */
export const OLD_DONE_DAYS = 60
export const DONE_SINCE = `-${OLD_DONE_DAYS}d`
const SHOW_ALL = { param: 'concluidos', value: 'todos' } as const

const NAMES_STATES: readonly (keyof CardFilter)[] = ['stateIds', 'notStateIds', 'stateGroups', 'movedTo', 'doneSince']

export const showsAllDone = (search: string): boolean =>
  new URLSearchParams(search).get(SHOW_ALL.param) === SHOW_ALL.value

/** Whether this Lista leaves the old done cards out: not when asked for all, nor under a filter of states. */
export const hidesOldDone = (filter: CardFilter, search: string): boolean =>
  !showsAllDone(search) && !NAMES_STATES.some((key) => filter[key] !== undefined)

/** The same address, showing every done card — or, with `false`, back to hiding the old ones. */
export const oldDoneHref = (href: string, show: boolean): string =>
  withParams(href, { [SHOW_ALL.param]: show ? SHOW_ALL.value : undefined })
