import { type AccessReview, governanceRead, governanceWrite, type ReviewItem } from '@/api/governance'
import { PRIVILEGE_LABEL } from '@/lib/governance'
import { type Html, html } from '@/lib/html'

import { on } from './access-systems'

/**
 * Periodic access reviews (ADR-0024): what an owner confirms or removes, item by item. Every quarter
 * for privileged profiles, every semester for the rest; what is left unanswered when the window
 * closes is removed.
 */
const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const DAY = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

const outcome = (item: ReviewItem): Html =>
  item.decided
    ? html`<span class="badge ${item.decision === 'remove' ? 'badge-danger' : ''}">${item.decision === 'remove' ? 'Removido' : 'Mantido'}</span>
        <span class="muted">${item.decided.by.name} · ${WHEN.format(new Date(item.decided.at))}${item.decided.note === 'unanswered' ? ' · sem resposta no prazo' : ''}</span>`
    : html`<span class="muted">Sem resposta</span>`

const itemRow = (review: AccessReview, item: ReviewItem): Html => html`
  <li class="access-row">
    <div class="access-row-head">
      <strong>${item.member.name}</strong><span class="muted">${item.profile.name}</span>
    </div>
    <p class="access-row-who">Desde ${DAY.format(new Date(item.grantedAt))}</p>
    <div class="request-actions">
      ${
        item.canDecide
          ? html`<button type="button" class="button button-secondary" data-keep="${item.entitlementId}" data-review="${review.id}">Manter</button>
            <button type="button" class="button button-ghost" data-drop="${item.entitlementId}" data-review="${review.id}">Remover</button>`
          : outcome(item)
      }
    </div>
  </li>
`

const reviewCard = (review: AccessReview): Html => html`
  <section class="section system-card ${review.closedAt ? 'is-closed' : ''}">
    <div class="system-head">
      <h2>${review.system.name}</h2>
      <span class="badge ${review.privilege === 'privileged' ? 'badge-warn' : ''}">${PRIVILEGE_LABEL[review.privilege]}</span>
      <span class="system-actions muted">${review.progress.decided} de ${review.progress.total} respondidos</span>
    </div>
    <p class="muted">
      Aberta por ${review.openedBy.name} em ${DAY.format(new Date(review.openedAt))} ·
      ${review.closedAt ? html`encerrada em ${DAY.format(new Date(review.closedAt))}` : html`prazo ${WHEN.format(new Date(review.dueAt))}; o que ficar sem resposta é removido`}
    </p>
    <ul class="access-list">${review.items.map((item) => itemRow(review, item))}</ul>
  </section>
`

export const reviewsSection = async (): Promise<Html> => {
  const reviews = (await governanceRead.reviews()).items
  const open = reviews.filter((each) => !each.closedAt)
  const closed = reviews.filter((each) => each.closedAt).slice(0, 20)
  return html`
    <p class="muted access-intro">O dono confirma quem continua com cada acesso. Ninguém revisa o próprio acesso.</p>
    ${open.length ? open.map(reviewCard) : html`<p class="muted">Nenhuma revisão aberta.</p>`}
    ${closed.length ? html`<h2 class="section-title">Encerradas</h2>${closed.map(reviewCard)}` : ''}
  `
}

export const bindReviews = (root: HTMLElement): void => {
  on(root, 'keep', (button) =>
    governanceWrite.decideReviewItem(button.dataset.review ?? '', button.dataset.keep ?? '', 'keep')
  )
  on(root, 'drop', async (button) => {
    if (confirm('Remover este acesso? O pedido de remoção vai para os operadores do sistema.')) {
      await governanceWrite.decideReviewItem(button.dataset.review ?? '', button.dataset.drop ?? '', 'remove')
    }
  })
}
