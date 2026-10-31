import type { DevLink } from '@/api/github'
import { shortDate, todayInSaoPaulo } from '@/lib/dates'
import {
  branchName,
  CHECKS_LABEL,
  checksOf,
  commitExample,
  commitPrefix,
  inReadingOrder,
  PULL_STATE_LABEL,
  REVIEW_LABEL
} from '@/lib/github'
import { type Html, html } from '@/lib/html'

import { type IconName, icon } from './icons'
import { toast } from './toast'

const PULL_ICON: Record<DevLink['state'], IconName> = {
  open: 'gitPullRequest',
  draft: 'gitPullRequestDraft',
  merged: 'gitMerge',
  closed: 'gitPullRequestClosed',
  active: 'gitBranch',
  deleted: 'gitBranch'
}

const when = (iso: string) => shortDate(todayInSaoPaulo(new Date(iso)))

const pullRow = (link: DevLink): Html => html`
  <li class="dev-link dev-${link.state}">
    ${icon(PULL_ICON[link.state], 16)}
    <span class="dev-link-main">
      <a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.title || `#${link.ref}`}</a>
      <span class="muted">${link.repo}#${link.ref} · ${link.author} · ${when(link.mergedAt ?? link.updatedAt)}</span>
    </span>
    <span class="dev-badges">
      <span class="badge dev-state">${PULL_STATE_LABEL[link.state]}</span>
      ${link.review ? html`<span class="badge dev-review-${link.review}">${REVIEW_LABEL[link.review]}</span>` : ''}
      ${link.checks ? html`<span class="badge dev-checks-${link.checks}">${CHECKS_LABEL[link.checks]}</span>` : ''}
    </span>
  </li>
`

const branchRow = (link: DevLink): Html => html`
  <li class="dev-link dev-${link.state}">
    ${icon('gitBranch', 16)}
    <span class="dev-link-main">
      <a href="${link.url}" target="_blank" rel="noopener noreferrer"><code>${link.ref}</code></a>
      <span class="muted">${link.repo}${link.author ? ` · ${link.author}` : ''}</span>
    </span>
    ${link.state === 'deleted' ? html`<span class="dev-badges"><span class="badge">${PULL_STATE_LABEL.deleted}</span></span>` : ''}
  </li>
`

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** A count that opens to its list, as Jira's: the newest pull request's state beside it. */
const more = (glyph: IconName, label: string, badge: Html | string, rows: Html[]): Html => html`
  <details class="dev-more">
    <summary class="dev-row">${icon(glyph, 16)}<span>${label}</span>${badge}</summary>
    <ul class="dev-links">${rows}</ul>
  </details>
`

const checksRow = (links: readonly DevLink[]): Html => {
  const checks = checksOf(links)
  if (!checks) {
    return html``
  }
  const glyph: IconName = checks === 'success' ? 'circleCheck' : checks === 'pending' ? 'clock' : 'x'
  return html`<div class="dev-row dev-row-static dev-checks-${checks}">${icon(glyph, 16)}<span>${CHECKS_LABEL[checks]}</span></div>`
}

/** A command to run, read-only beside the button that copies it. */
const copyField = (label: string, value: string): Html => html`
  <label class="dev-copy">
    <span class="dev-copy-label">${label}</span>
    <span class="dev-copy-row">
      <input class="input" type="text" readonly value="${value}" />
      <button type="button" class="button button-secondary button-icon" data-copy="${value}" aria-label="Copiar ${label.toLowerCase()}" title="Copiar">${icon('copy', 16)}</button>
    </span>
  </label>
`

/** A row that opens to what it explains, the chevron on its right, as Jira's. */
const howTo = (glyph: IconName, label: string, title: string, body: Html): Html => html`
  <details class="dev-more dev-how">
    <summary class="dev-row">${icon(glyph, 16)}<span>${label}</span>${icon('chevronDown', 14)}</summary>
    <div class="dev-how-body">
      <p class="dev-how-title">${title}</p>
      ${body}
    </div>
  </details>
`

/** What the card's work starts from; a type that looks like a bug (ADR-0031) is a `fix`. */
export type DevStart = { key: string; title: string; bug: boolean }

const starts = (start: DevStart): Html => html`
  ${howTo(
    'gitBranch',
    'Criar branch',
    'Criar e entrar na nova branch',
    copyField('Comando', `git checkout -b ${branchName(start.key, start.title, start.bug)}`)
  )}
  ${howTo(
    'gitCommit',
    'Criar commit',
    'Vincular ao card',
    html`
      <p class="muted dev-how-hint">Comece a mensagem do commit e o título do pull request com o tipo e a chave do card.</p>
      ${copyField('Início da mensagem', commitPrefix(start.key, start.bug))}
      ${copyField('Exemplo de commit', commitExample(start.key, start.title, start.bug))}
    `
  )}
`

/**
 * The card's development (Etapa 9, ADR-0038), in the side column as Jira has it: how to start the work —
 * the branch to create, the key for commits — then how many pull requests and branches name the card,
 * each opening to its list, and their checks. Without GitHub, first the way to connect it.
 */
export const developmentGroup = (links: readonly DevLink[], start: DevStart, connected: boolean): Html => {
  const pulls = inReadingOrder(links).filter((link) => link.kind === 'pull_request')
  const branches = links.filter((link) => link.kind === 'branch')
  const newest = pulls[0]
  return html`
    ${connected ? '' : html`<a class="dev-row" href="/github">${icon('github', 16)}<span>Conectar ferramentas de desenvolvimento</span></a>`}
    ${starts(start)}
    ${
      pulls.length
        ? more(
            'gitPullRequest',
            plural(pulls.length, 'pull request', 'pull requests'),
            newest
              ? html`<span class="badge dev-state dev-state-${newest.state}">${PULL_STATE_LABEL[newest.state]}</span>`
              : '',
            pulls.map(pullRow)
          )
        : ''
    }
    ${branches.length ? more('gitBranch', plural(branches.length, 'branch', 'branches'), '', branches.map(branchRow)) : ''}
    ${checksRow(pulls)}
  `
}

export const bindDevelopment = (root: HTMLElement): void => {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-side-group="development"] [data-copy]')) {
    button.addEventListener('click', () => {
      const value = button.dataset.copy ?? ''
      void navigator.clipboard
        .writeText(value)
        .then(() => toast(`Copiado: ${value}`))
        .catch(() => toast(`Não deu para copiar. O texto é ${value}`, 'error'))
    })
  }
}
