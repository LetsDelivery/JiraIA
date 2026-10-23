/**
 * The card filter the panel keeps in the address (`?filtro=`), so a filtered board, list or backlog is
 * a link someone else can open (escopo-mvp 3.4). The API reads the same shape; this module only edits
 * it, one condition at a time, and never keeps an empty condition around.
 */
import type { paths } from '@/api/schema'

type SearchBody = NonNullable<paths['/work/cards/search']['post']['requestBody']>['content']['application/json']
export type CardFilter = NonNullable<SearchBody['filter']>
export type Range = NonNullable<CardFilter['created']>

/** The conditions offered as chips: each holds a list of values, any of which matches. */
export type ListKey = 'typeIds' | 'stateIds' | 'assignees' | 'priorities' | 'labelsAny' | 'sprints'

const _empty = (value: unknown): boolean =>
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)

/** The filter without the conditions that hold nothing. */
export const clean = (filter: CardFilter): CardFilter =>
  Object.fromEntries(Object.entries(filter).filter(([, value]) => !_empty(value))) as CardFilter

export const isEmpty = (filter: CardFilter): boolean => Object.keys(clean(filter)).length === 0

/** How many conditions the filter has — a custom field counts once per field. */
export const conditionCount = (filter: CardFilter): number => {
  const { fields, ...rest } = clean(filter)
  return Object.keys(rest).length + (fields?.length ?? 0)
}

/** Reads `?filtro=`; anything that is not a JSON object is no filter at all. */
export const readFilter = (search: string): CardFilter => {
  const raw = new URLSearchParams(search).get('filtro')
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? clean(parsed) : {}
  } catch {
    return {}
  }
}

/**
 * Adds the value to the condition, or takes it off when it is there.
 *
 * @example toggleValue({ priorities: ['high'] }, 'priorities', 'high')   // {}
 */
export const toggleValue = (filter: CardFilter, key: ListKey, value: string): CardFilter => {
  const list: string[] = filter[key] ?? []
  const next = list.includes(value) ? list.filter((each) => each !== value) : [...list, value]
  return clean({ ...filter, [key]: next })
}

/** The same for one option of a custom field: a field left with no option leaves the filter. */
export const toggleField = (filter: CardFilter, fieldId: string, option: string): CardFilter => {
  const current = filter.fields?.find((each) => each.fieldId === fieldId)?.anyOf.map(String) ?? []
  const anyOf = current.includes(option) ? current.filter((each) => each !== option) : [...current, option]
  const others = (filter.fields ?? []).filter((each) => each.fieldId !== fieldId)
  return clean({ ...filter, fields: anyOf.length ? [...others, { fieldId, anyOf }] : others })
}

export const has = (filter: CardFilter, key: ListKey, value: string): boolean =>
  (filter[key] as string[] | undefined)?.includes(value) ?? false

export const hasField = (filter: CardFilter, fieldId: string, option: string): boolean =>
  filter.fields?.some((each) => each.fieldId === fieldId && each.anyOf.map(String).includes(option)) ?? false

/** The periods offered for "criado" and "atualizado": days back from now, as the API reads them. */
export const PERIODS = [
  { value: '', label: 'Qualquer data' },
  { value: '-1d', label: 'Últimas 24 horas' },
  { value: '-7d', label: 'Últimos 7 dias' },
  { value: '-30d', label: 'Últimos 30 dias' },
  { value: '-90d', label: 'Últimos 90 dias' }
]

/** The due-date choices: overdue, or due within some days. */
export const DUE_CHOICES = [
  { value: '', label: 'Qualquer data limite' },
  { value: 'overdue', label: 'Vencidos' },
  { value: 'week', label: 'Vencem em 7 dias' },
  { value: 'month', label: 'Vencem em 30 dias' }
]

const DUE_RANGE: Record<string, Range | undefined> = {
  overdue: { to: '-1d' },
  week: { from: '+0d', to: '+7d' },
  month: { from: '+0d', to: '+30d' }
}

export const dueRange = (choice: string): Range | undefined => DUE_RANGE[choice]

export const dueChoice = (range: Range | undefined): string =>
  Object.entries(DUE_RANGE).find(([, each]) => JSON.stringify(each) === JSON.stringify(range))?.[0] ?? ''

/**
 * The address with these parameters set, or removed when `undefined` — the rest kept as they are.
 *
 * @example withParams('/espacos/PRD?aba=lista', { filtro: '{}' })   // '/espacos/PRD?aba=lista&filtro=%7B%7D'
 */
export const withParams = (href: string, params: Record<string, string | undefined>): string => {
  const url = new URL(href, 'http://panel')
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      url.searchParams.delete(key)
    } else {
      url.searchParams.set(key, value)
    }
  }
  return `${url.pathname}${url.search}`
}

/** `?filtro=` for this filter, or nothing when it is empty. */
export const filterParam = (filter: CardFilter): string | undefined =>
  isEmpty(filter) ? undefined : JSON.stringify(clean(filter))

const _canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(_canonical)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, _canonical((value as Record<string, unknown>)[key])])
    )
  }
  return value
}

/** Two filters with the same conditions, whatever order their keys came in. */
export const sameFilter = (a: CardFilter, b: CardFilter): boolean =>
  JSON.stringify(_canonical(clean(a))) === JSON.stringify(_canonical(clean(b)))

/** A view's filter as a space's screen applies it: the space is the screen's, not the view's list. */
export const withoutSpaces = (filter: CardFilter): CardFilter => {
  const { spaceIds: _spaceIds, ...rest } = filter
  return clean(rest)
}

/** The filter with one condition set, or taken off when `value` is `undefined`. */
export const withCondition = <K extends keyof CardFilter>(
  filter: CardFilter,
  key: K,
  value: CardFilter[K] | undefined
): CardFilter => {
  const rest = Object.fromEntries(Object.entries(filter).filter(([each]) => each !== key)) as CardFilter
  return value === undefined ? clean(rest) : clean({ ...rest, [key]: value })
}

/**
 * Who the Responsável filter offers in a space: whoever holds a role in it and whoever a card of it is
 * assigned to, plus anyone the filter already names — not every person of the organization.
 *
 * @example assignableIds([{ memberId: 'ana' }], [{ assignee: { id: 'bia' } }], {})   // Set { 'ana', 'bia' }
 */
export const assignableIds = (
  roles: readonly { memberId: string }[],
  cards: readonly { assignee: { id: string } | null }[],
  filter: CardFilter
): Set<string> =>
  new Set([
    ...roles.map((role) => role.memberId),
    ...cards.flatMap((card) => (card.assignee ? [card.assignee.id] : [])),
    ...(filter.assignees ?? [])
  ])
