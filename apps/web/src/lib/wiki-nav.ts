import { todayInSaoPaulo } from './dates'
import { dayOf } from './wiki'

/**
 * The pure parts of LET’S Wiki's navigation (docs/produto/wiki-navegacao.md): how long ago something
 * changed, how many pages sit under a page, what a long sidebar section shows first, and which pages a
 * collection's filter keeps.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Whole days between two São Paulo calendar days (`YYYY-MM-DD`). */
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY)

const plural = (count: number, one: string, many: string): string => `há ${count} ${count === 1 ? one : many}`

/**
 * "agora", "há 5 minutos", "há 2 horas", "ontem", "há 5 dias" — or the date, past a week. Days are
 * counted on São Paulo's calendar, so "ontem" means yesterday there, whatever the browser's zone.
 *
 * @example relativeTime('2026-10-24T12:00:00Z', new Date('2026-10-24T14:30:00Z'))   // 'há 2 horas'
 */
export const relativeTime = (instant: string, now = new Date()): string => {
  const elapsed = Math.max(0, now.getTime() - Date.parse(instant))
  const days = daysBetween(todayInSaoPaulo(new Date(instant)), todayInSaoPaulo(now))
  if (elapsed < MINUTE) {
    return 'agora'
  }
  if (elapsed < HOUR) {
    return plural(Math.floor(elapsed / MINUTE), 'minuto', 'minutos')
  }
  if (days === 0) {
    return plural(Math.floor(elapsed / HOUR), 'hora', 'horas')
  }
  if (days === 1) {
    return 'ontem'
  }
  return days < 7 ? plural(days, 'dia', 'dias') : dayOf(instant)
}

type Node = { id: string; parentId: string | null; position: number }

/** How many pages sit under each page, at any depth — a page with none is absent. */
export const subpageCounts = (nodes: readonly Node[]): Map<string, number> => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const seen = new Set<string>()
    for (let parent = node.parentId; parent && !seen.has(parent); parent = byId.get(parent)?.parentId ?? null) {
      seen.add(parent)
      counts.set(parent, (counts.get(parent) ?? 0) + 1)
    }
  }
  return counts
}

/** The pages right under `parentId` (`null` for the first level), in their order. */
export const childrenOf = <T extends Node>(nodes: readonly T[], parentId: string | null): T[] =>
  nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.position - b.position)

/** A long sidebar section shows its first eight; the rest wait behind "Ver todas". */
export const SECTION_LIMIT = 8

export const sliceSection = <T>(items: readonly T[], limit = SECTION_LIMIT): { shown: T[]; rest: T[] } => ({
  shown: items.slice(0, limit),
  rest: items.slice(limit)
})

/** A tree cut to its first `limit` top-level pages, each with everything under it. */
export const firstRoots = <T extends Node>(nodes: readonly T[], limit = SECTION_LIMIT): T[] => {
  const kept = new Set(
    childrenOf(nodes, null)
      .slice(0, limit)
      .map((node) => node.id)
  )
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rootOf = (node: T): string => {
    let current: Node = node
    for (let hops = 0; current.parentId && hops < nodes.length; hops += 1) {
      current = byId.get(current.parentId) ?? { ...current, parentId: null }
    }
    return current.id
  }
  return nodes.filter((node) => kept.has(rootOf(node)))
}

/** Lower case, without accents: "Operação" is found by "operacao". */
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

export const matchesName = (name: string, query: string): boolean => fold(name).includes(fold(query))

export type StateFilter = 'all' | 'official' | 'draft' | 'overdue'
export type PageFilter = { text: string; state: StateFilter; ownerId?: string | undefined }

export const STATE_FILTERS: readonly { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'Todos os estados' },
  { value: 'official', label: 'Oficiais' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'overdue', label: 'Revisão vencida' }
]

type Filterable = { title: string; kind: string; state: 'draft' | 'official'; overdue: boolean; owner: { id: string } }

const STATE_TEST: Record<StateFilter, (page: Filterable) => boolean> = {
  all: () => true,
  official: (page) => page.state === 'official',
  draft: (page) => page.state === 'draft',
  overdue: (page) => page.overdue
}

/** Whether the collection's filter is doing anything — then its table lists matches flat. */
export const filtering = (filter: PageFilter): boolean =>
  Boolean(filter.text.trim()) || filter.state !== 'all' || Boolean(filter.ownerId)

/** The pages a filter keeps, at any depth; folders hold no state or owner, so they drop out. */
export const filterPages = <T extends Filterable>(nodes: readonly T[], filter: PageFilter): T[] =>
  nodes.filter(
    (node) =>
      node.kind !== 'folder' &&
      STATE_TEST[filter.state](node) &&
      (!filter.ownerId || node.owner.id === filter.ownerId) &&
      matchesName(node.title, filter.text)
  )

/** "Ana Souza", or "Ana Souza +2" when the collection has more owners. */
export const ownersLabel = (owners: readonly { name: string }[]): string => {
  const [first] = owners
  if (!first) {
    return '—'
  }
  return owners.length > 1 ? `${first.name} +${owners.length - 1}` : first.name
}

/** A comment thread is the page's own, or held to a stretch of its text. */
export const threadKind = (comment: { anchorId?: string | null }): 'page' | 'inline' =>
  comment.anchorId ? 'inline' : 'page'
