import type { Proposal, ProposalItem } from '@/api/proposals'
import { type Html, html } from '@/lib/html'
import {
  adjustableValues,
  age,
  fieldLabel,
  ITEM_STATUS_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
  valueText
} from '@/lib/proposals'
import { spacePath } from '@/lib/space-types'

import { icon } from './icons'

/**
 * One proposal as an approver reads it (ADR-0019): the agent and its reason, each change with what
 * it was and what it becomes, what moved on since, and the decision. Pure markup; `bindProposals` acts.
 */
export const proposalCard = (proposal: Proposal, now: Date, focused = false): Html => html`
  <article class="proposal ${focused ? 'is-focused' : ''}" id="proposta-${proposal.id}" data-proposal="${proposal.id}">
    ${head(proposal, now)}
    <ol class="proposal-items">${proposal.items.map((item) => itemRow(proposal, item))}</ol>
    ${footer(proposal)}
  </article>
`

const head = (proposal: Proposal, now: Date): Html => html`
  <header class="proposal-head">
    <span class="proposal-agent" aria-hidden="true">${icon('robot', 18)}</span>
    <div class="proposal-who">
      <p>
        <strong>${proposal.author.name}</strong>
        propôs em <a href="${spacePath(proposal.space.key)}">${proposal.space.name}</a>
        <span class="muted">· ${age(proposal.createdAt, now)}</span>
      </p>
      <p class="proposal-reason">${proposal.reason}</p>
    </div>
    <span class="badge proposal-status is-${proposal.status}">${STATUS_LABEL[proposal.status]}${proposal.autoApplied ? ' automaticamente' : ''}</span>
  </header>
`

const itemHead = (proposal: Proposal, item: ProposalItem): Html => html`
  <div class="proposal-item-head">
    ${proposal.canDecide ? html`<input type="checkbox" class="checkbox" data-choose checked aria-label="Aplicar ${KIND_LABEL[item.kind]}" />` : ''}
    <span class="chip">${KIND_LABEL[item.kind]}</span>
    ${item.card ? html`<a class="proposal-card-ref" href="${spacePath(item.card.key.split('-')[0] ?? '')}?card=${item.card.key}">${item.card.key}</a><span class="muted ellipsis">${item.card.title}</span>` : ''}
    ${proposal.status === 'pending' ? '' : html`<span class="proposal-item-status">${ITEM_STATUS_LABEL[item.status]}</span>`}
  </div>
`

const itemRow = (proposal: Proposal, item: ProposalItem): Html => {
  const changes = Object.entries(item.changes)
  return html`
    <li class="proposal-item is-${item.status}" data-item="${item.id}">
      ${itemHead(proposal, item)}
      ${changes.length ? diffTable(changes, proposal.names) : ''}
      ${conflicts(item, proposal.names)}
      ${proposal.canDecide ? adjuster(item) : ''}
      ${item.adjusted && !proposal.canDecide ? html`<p class="muted proposal-note">Ajustada por quem aprovou.</p>` : ''}
      ${item.error ? html`<p class="proposal-error">${icon('x', 14)}Esta mudança não pôde ser aplicada. As outras seguiram.</p>` : ''}
    </li>
  `
}

const diffTable = (changes: [string, { before?: unknown; after?: unknown }][], names: Record<string, string>) => html`
  <table class="proposal-diff">
    <tbody>
      ${changes.map(
        ([field, change]) => html`
          <tr>
            <th scope="row">${fieldLabel(field, names)}</th>
            <td class="is-before">${valueText(field, change.before, names)}</td>
            <td class="proposal-arrow" aria-label="vira">${icon('arrowNarrowRight', 14)}</td>
            <td class="is-after">${valueText(field, change.after, names)}</td>
          </tr>`
      )}
    </tbody>
  </table>
`

const conflicts = (item: ProposalItem, names: Record<string, string>): Html => {
  const fields = Object.entries(item.conflicts)
  if (fields.length === 0) {
    return html``
  }
  return html`
    <div class="proposal-conflict" role="note">
      <strong>Desatualizada:</strong> o card mudou depois da proposta.
      ${fields.map(([field, change]) => html`<span>${fieldLabel(field, names)} agora é <em>${valueText(field, change.after, names)}</em>.</span>`)}
    </div>
  `
}

/** The text an approver may rewrite, hidden until they ask; the agent's version stays above it. */
const adjuster = (item: ProposalItem): Html => {
  const values = Object.entries(adjustableValues(item.adjusted ?? item.proposed))
  if (values.length === 0) {
    return html``
  }
  return html`
    <details class="proposal-adjust">
      <summary>${icon('pencil', 14)}Ajustar antes de aprovar</summary>
      ${values.map(
        ([field, value]) => html`
          <label class="field">
            <span class="label">${fieldLabel(field, {})}</span>
            ${field === 'title' ? html`<input class="input" data-adjust="${field}" value="${value}" maxlength="255" />` : html`<textarea class="input" rows="3" data-adjust="${field}">${value}</textarea>`}
          </label>`
      )}
    </details>
  `
}

const decided = (proposal: Proposal): Html => {
  if (proposal.revertedBy) {
    return html`<p class="muted">Revertida por ${proposal.revertedBy.name}.</p>`
  }
  if (proposal.decidedBy) {
    return html`<p class="muted">Decidida por ${proposal.decidedBy.name}${proposal.note ? html` — “${proposal.note}”` : ''}</p>`
  }
  return proposal.status === 'pending' ? html`<p class="muted">Vence em 14 dias se ninguém decidir.</p>` : html``
}

const footer = (proposal: Proposal): Html => {
  const stale = proposal.items.some((item) => Object.keys(item.conflicts).length > 0)
  return html`
    <footer class="proposal-actions">
      ${decided(proposal)}
      ${
        proposal.canDecide
          ? html`
            ${stale ? html`<label class="proposal-ack"><input type="checkbox" class="checkbox" data-acknowledge />Aplicar mesmo com o card alterado</label>` : ''}
            <div class="row">
              <button type="button" class="button button-ghost" data-reject>Recusar</button>
              <button type="button" class="button button-primary" data-approve>${icon('circleCheck', 16)}Aprovar</button>
            </div>`
          : ''
      }
      ${proposal.canRevert ? html`<button type="button" class="button button-secondary" data-revert>${icon('restore', 16)}Reverter</button>` : ''}
    </footer>
  `
}
