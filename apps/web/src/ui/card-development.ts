import type { DevLink } from '@/api/github'
import { shortDate, todayInSaoPaulo } from '@/lib/dates'
import { CHECKS_LABEL, inReadingOrder, PULL_STATE_LABEL, REVIEW_LABEL } from '@/lib/github'
import { type Html, html } from '@/lib/html'

import { detailPanel } from './detail-panel'
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

/**
 * The card's development (Etapa 9, ADR-0038): the pull requests and branches GitHub said name it, and
 * the name its branch should have. Shown when GitHub is connected or the card already has some.
 */
export const developmentSection = (links: readonly DevLink[], branch: string, connected: boolean): Html => {
  if (!connected && links.length === 0) {
    return html``
  }
  const rows = inReadingOrder(links).map((link) => (link.kind === 'pull_request' ? pullRow(link) : branchRow(link)))
  return detailPanel({
    title: html`Desenvolvimento ${links.length ? html`<span class="count">${links.length}</span>` : ''}`,
    attributes: html`data-development`,
    actions: html`<button type="button" class="button button-ghost" data-copy-branch="${branch}" title="${branch}">${icon('copy', 16)}Copiar nome da branch</button>`,
    body: rows.length
      ? html`<ul class="dev-links">${rows}</ul>`
      : html`<p class="muted">Nenhuma branch ou pull request com a chave deste card ainda. Crie a branch com o nome copiado acima.</p>`
  })
}

export const bindDevelopment = (root: HTMLElement): void => {
  root.querySelector<HTMLButtonElement>('[data-copy-branch]')?.addEventListener('click', (event) => {
    const branch = (event.currentTarget as HTMLButtonElement).dataset.copyBranch ?? ''
    void navigator.clipboard
      .writeText(branch)
      .then(() => toast(`Copiado: ${branch}`))
      .catch(() => toast(`Não deu para copiar. O nome é ${branch}`, 'error'))
  })
}
