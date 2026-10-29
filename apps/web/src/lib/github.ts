import type { DevLink } from '@/api/github'

/**
 * What the card shows of GitHub (Etapa 9, ADR-0038): the name its branch should have, and the words for
 * a pull request's state, review and checks.
 */
const SLUG_LENGTH = 40

/** The title as a branch name accepts it: lower case, no accents, words joined by hyphens. */
const slugOf = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/, '')

/**
 * The branch a card's work goes on: `fix/` for a bug, `feat/` for anything else, then the key, then the
 * title. The key is what links the branch to the card; the rest is for people.
 *
 * @example branchName('REQ-12', 'Frete por região', false)   // 'feat/REQ-12-frete-por-regiao'
 */
export const branchName = (key: string, title: string, bug: boolean): string => {
  const slug = slugOf(title)
  return `${bug ? 'fix' : 'feat'}/${key}${slug ? `-${slug}` : ''}`
}

export const PULL_STATE_LABEL: Record<DevLink['state'], string> = {
  open: 'Aberto',
  draft: 'Rascunho',
  merged: 'Mergeado',
  closed: 'Fechado',
  active: 'Ativa',
  deleted: 'Apagada'
}

export const REVIEW_LABEL: Record<NonNullable<DevLink['review']>, string> = {
  approved: 'Aprovado',
  changes_requested: 'Mudanças pedidas'
}

export const CHECKS_LABEL: Record<NonNullable<DevLink['checks']>, string> = {
  pending: 'Checks rodando',
  success: 'Checks ok',
  failure: 'Checks falharam'
}

/** Pull requests first, then branches; inside each, the latest news first, as the API sends them. */
export const inReadingOrder = (links: readonly DevLink[]): DevLink[] => [
  ...links.filter((link) => link.kind === 'pull_request'),
  ...links.filter((link) => link.kind === 'branch')
]
