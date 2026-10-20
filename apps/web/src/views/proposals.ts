import { type Approval, type Proposal, proposalsRead, proposalsWrite } from '@/api/proposals'
import { type Html, html } from '@/lib/html'
import { adjustableValues, adjusted } from '@/lib/proposals'
import { refusalSentence } from '@/lib/refusal'
import { openFormDialog } from '@/ui/dialog'
import { proposalCard } from '@/ui/proposal-card'
import { toast } from '@/ui/toast'

import type { View } from './view'

type Tab = 'pending' | 'decided'

const currentTab = (): Tab => (new URLSearchParams(location.search).get('aba') === 'decididas' ? 'decided' : 'pending')
const focusedId = (): string | null => new URLSearchParams(location.search).get('proposta')

const tabs = (current: Tab, pending: number) => html`
  <nav class="tabs" aria-label="Propostas">
    <a class="tab" href="/propostas" ${current === 'pending' ? html`aria-current="page"` : ''}>Pendentes${pending ? html` <span class="count">${pending}</span>` : ''}</a>
    <a class="tab" href="/propostas?aba=decididas" ${current === 'decided' ? html`aria-current="page"` : ''}>Decididas</a>
  </nav>
`

const EMPTY: Record<Tab, Html> = {
  pending: html`<div class="empty"><p class="empty-title">Nenhuma proposta esperando você.</p><p class="muted">Quando um agente propuser mudanças num espaço em que você escreve, elas aparecem aqui.</p></div>`,
  decided: html`<div class="empty"><p class="empty-title">Nenhuma proposta decidida ainda.</p></div>`
}

/**
 * Propostas (escopo-mvp 6.2, ADR-0019): what agents asked to change where you write — to approve whole,
 * in part or adjusted, or to reject — and what was decided, to revert if it went wrong.
 */
export const proposalsView: View = {
  path: '/propostas',
  title: 'Propostas',
  render: async () => {
    const tab = currentTab()
    const [list, count] = await Promise.all([proposalsRead.list(tab), proposalsRead.pendingCount()])
    const now = new Date()
    const focused = focusedId()
    return html`
      <header class="page-header"><h1>Propostas</h1><p class="muted">Agentes propõem, pessoas aprovam. Nada muda sem a sua decisão.</p></header>
      ${tabs(tab, count.pending)}
      <section class="section proposal-list">
        ${list.items.length ? list.items.map((proposal) => proposalCard(proposal, now, proposal.id === focused)) : EMPTY[tab]}
      </section>
    `
  },
  bind: (root) => bindProposals(root, async () => (await proposalsRead.list(currentTab())).items)
}

const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')

/**
 * The decisions on any list of proposal cards — this page, or the strip on a card. `current` reads the
 * proposals on screen, so a click acts on what the person sees.
 */
export const bindProposals = (root: HTMLElement, current: () => Promise<readonly Proposal[]>): void => {
  document.getElementById(`proposta-${focusedId()}`)?.scrollIntoView({ block: 'center' })
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-approve],[data-reject],[data-revert]'
    )
    const article = button?.closest<HTMLElement>('[data-proposal]')
    if (!button || !article) {
      return
    }
    void current()
      .then((proposals) => proposals.find((each) => each.id === article.dataset.proposal))
      .then((proposal) => proposal && _act(button, article, proposal))
      .catch(refuse)
  })
}

const _act = (button: HTMLButtonElement, article: HTMLElement, proposal: Proposal) => {
  if (button.matches('[data-approve]')) {
    return _approve(button, article, proposal)
  }
  if (button.matches('[data-reject]')) {
    return _reject(proposal)
  }
  return _revert(proposal)
}

const _approve = async (button: HTMLButtonElement, article: HTMLElement, proposal: Proposal) => {
  const approval = approvalFrom(article, proposal)
  if (approval.itemIds?.length === 0) {
    toast('Marque ao menos uma mudança para aprovar, ou recuse a proposta.', 'error')
    return
  }
  button.disabled = true
  const result = await proposalsWrite.approve(proposal.id, approval).finally(() => {
    button.disabled = false
  })
  const failed = result.items.filter((item) => item.status === 'failed').length
  toast(failed ? `Proposta aplicada, com ${failed} mudança(s) que falharam.` : 'Proposta aplicada.')
}

/** What the person chose on the card: the ticked items, their rewritten text, and the conflict consent. */
export const approvalFrom = (article: HTMLElement, proposal: Proposal): Approval => {
  const adjustments: Approval['adjustments'] = []
  const itemIds: string[] = []
  for (const item of proposal.items) {
    const row = article.querySelector<HTMLElement>(`[data-item="${item.id}"]`)
    if (row?.querySelector<HTMLInputElement>('[data-choose]')?.checked) {
      itemIds.push(item.id)
    }
    const input = item.adjusted ?? item.proposed
    const before = adjustableValues(input)
    const typed = Object.fromEntries(
      [...(row?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-adjust]') ?? [])].map((field) => [
        field.dataset.adjust ?? '',
        field.value
      ])
    )
    if (Object.entries(typed).some(([field, value]) => before[field] !== value)) {
      adjustments.push({ itemId: item.id, item: adjusted(input, typed) })
    }
  }
  const acknowledge = article.querySelector<HTMLInputElement>('[data-acknowledge]')?.checked ?? false
  return { itemIds, adjustments, acknowledgeConflicts: acknowledge, note: '' }
}

const _reject = (proposal: Proposal) =>
  openFormDialog({
    title: 'Recusar proposta',
    submit: 'Recusar',
    done: 'Proposta recusada.',
    fields: html`
      <p class="muted">${proposal.author.name} vai ler o motivo, se você escrever um.</p>
      <div class="field"><label for="reject-note">Motivo (opcional)</label><textarea id="reject-note" class="input" name="note" rows="3" maxlength="2000"></textarea></div>
    `,
    onSubmit: (data) => proposalsWrite.reject(proposal.id, String(data.get('note') ?? ''))
  })

const _revert = (proposal: Proposal) =>
  openFormDialog({
    title: 'Reverter proposta',
    submit: 'Reverter',
    done: 'Proposta revertida.',
    fields: html`<p>As mudanças aplicadas voltam atrás: cards criados vão para o estado cancelado, campos voltam ao valor anterior, comentários saem e vínculos são desfeitos. Se alguém mexeu no card depois, nada é revertido.</p>`,
    onSubmit: () => proposalsWrite.revert(proposal.id)
  })
