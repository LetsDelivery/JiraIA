import { shortDate, todayInSaoPaulo } from './dates'
import { type ContentPaths, contentPath, DRAW_PATHS } from './draw'

/**
 * LET’S Wiki's addresses (ADR-0033): everything under `/wiki`, a collection and its pages by id.
 *
 * @example wikiPagePath('c1', 'p1')   // '/wiki/c1/p1'
 */
export const WIKI_HOME = '/wiki'
export const WIKI_REVIEWS = `${WIKI_HOME}/revisoes`
export const WIKI_COLLECTIONS = `${WIKI_HOME}/colecoes`

export const collectionPath = (collectionId: string): string => `${WIKI_HOME}/${collectionId}`

export const wikiPagePath = (collectionId: string, contentId: string): string =>
  `${collectionPath(collectionId)}/${contentId}`

export const WIKI_PATHS: ContentPaths = { space: collectionPath, content: wikiPagePath }

export type Area = 'draw' | 'wiki'

/** The addresses of a product's spaces and content. */
export const pathsIn = (area: Area = 'draw'): ContentPaths => (area === 'wiki' ? WIKI_PATHS : DRAW_PATHS)

/** Where a search result opens: in the product it belongs to. */
export const contentPathIn = (area: Area, spaceId: string, contentId: string): string =>
  area === 'wiki' ? wikiPagePath(spaceId, contentId) : contentPath(spaceId, contentId)

/** How close an official page's review date is before its owner is told (as the API counts). */
const DUE_SOON_DAYS = 14
const DAY = 24 * 60 * 60 * 1000

export type PageMark = { state: 'draft' | 'official'; reviewDue: string | null; overdue: boolean }
export type MarkTone = 'draft' | 'official' | 'due' | 'overdue'

/** "21/01/2027", the day an instant falls on in São Paulo. */
export const dayOf = (instant: string): string => shortDate(todayInSaoPaulo(new Date(instant)))

/**
 * What a page's mark says: a draft; official; official with its review near; or past it — still
 * official, but possibly out of date.
 */
export const pageMark = (page: PageMark, now = new Date()): { tone: MarkTone; label: string } => {
  if (page.state === 'draft') {
    return { tone: 'draft', label: 'Rascunho' }
  }
  if (page.overdue) {
    return { tone: 'overdue', label: 'Revisão vencida' }
  }
  const due = page.reviewDue ? new Date(page.reviewDue).getTime() : Number.POSITIVE_INFINITY
  return due - now.getTime() <= DUE_SOON_DAYS * DAY
    ? { tone: 'due', label: `Revisar até ${dayOf(page.reviewDue ?? '')}` }
    : { tone: 'official', label: 'Oficial' }
}

/** The review periods a collection offers, in days. */
export const REVIEW_PERIODS = [
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '6 meses' },
  { value: '365', label: '1 ano' }
] as const

/** Who reads a collection (ADR-0034): all of LET’S, only who holds a role, or its owner alone. */
export type Access = 'organization' | 'restricted' | 'personal'

export const ACCESS_LABEL: Record<Access, string> = {
  organization: 'Toda a LET’S',
  restricted: 'Restrita',
  personal: 'Pessoal'
}

/** What an owner may choose for a shared collection; a personal one stays personal. */
export const ACCESS_OPTIONS = [
  { value: 'organization', label: 'Toda a LET’S', hint: 'Todos leem; donos e editores escrevem' },
  { value: 'restricted', label: 'Restrita', hint: 'Só quem recebeu papel — pessoa ou grupo — lê' }
] as const
