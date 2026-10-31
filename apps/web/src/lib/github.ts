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

/** The conventional-commit type of a card's work: `fix` for a bug, `feat` for anything else. */
const typeOf = (bug: boolean): string => (bug ? 'fix' : 'feat')

/**
 * The branch a card's work goes on: the type, then the key, then the title. The key is what links the
 * branch to the card; the rest is for people.
 *
 * @example branchName('REQ-12', 'Frete por região', false)   // 'feat/REQ-12-frete-por-regiao'
 */
export const branchName = (key: string, title: string, bug: boolean): string => {
  const slug = slugOf(title)
  return `${typeOf(bug)}/${key}${slug ? `-${slug}` : ''}`
}

/**
 * How a commit message and a pull request's title start, as conventional commits with the card's key
 * as the scope. The key there is what links the pull request to the card.
 *
 * @example commitPrefix('REQ-12', false)   // 'feat(REQ-12):'
 */
export const commitPrefix = (key: string, bug: boolean): string => `${typeOf(bug)}(${key}):`

/**
 * A commit to copy: the prefix, then the card's title, escaped for the shell's double quotes.
 *
 * @example commitExample('REQ-12', 'Frete "grátis"', false)   // 'git commit -m "feat(REQ-12): Frete \\"grátis\\""'
 */
export const commitExample = (key: string, title: string, bug: boolean): string =>
  `git commit -m "${commitPrefix(key, bug)} ${title.replace(/["\\$`]/g, '\\$&')}"`

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

/**
 * The pull requests' checks as one word, as Jira sums its builds: any failure fails, then any still
 * running, then all passed. Nothing when no pull request has checks.
 */
export const checksOf = (links: readonly DevLink[]): DevLink['checks'] => {
  const all = links.flatMap((link) => (link.checks ? [link.checks] : []))
  if (all.length === 0) {
    return null
  }
  return all.includes('failure') ? 'failure' : all.includes('pending') ? 'pending' : 'success'
}
