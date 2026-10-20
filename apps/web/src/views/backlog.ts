import { type Card, write } from '@/api/requests'
import { invalidate } from '@/lib/cache'
import { dropIndex, initials, PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import { type BoardContext, bindOpenCards } from './board'

/** The backlog holds what is still open: states not started or in progress — not done, not cancelled. */
const backlogCards = (context: BoardContext): Card[] => {
  const open = new Set(
    context.workflow.states
      .filter((state) => state.group === 'not_started' || state.group === 'in_progress')
      .map((state) => state.id)
  )
  return context.cards
    .filter((card) => open.has(card.stateId))
    .sort((a, b) => a.backlogRank - b.backlogRank || a.number - b.number)
}

/** The order is the whole backlog's, so it is changed only when every open card is on screen. */
const reorders = (context: BoardContext): boolean => context.canWrite && !context.filtered

const row = (card: Card, position: number, context: BoardContext): Html => {
  const state = context.workflow.states.find((each) => each.id === card.stateId)
  return html`
    <li class="backlog-row" data-card-id="${card.id}" ${reorders(context) ? html`draggable="true"` : ''}>
      ${reorders(context) ? html`<span class="grip" aria-hidden="true">${icon('grip', 16)}</span>` : ''}
      <span class="backlog-position data">${position}</span>
      <span class="card-key">${card.key}</span>
      <button type="button" class="link card-open-inline backlog-title" data-open-card="${card.id}">${card.title}</button>
      <span class="state-chip"><span class="group-dot group-${state?.group ?? 'not_started'}" aria-hidden="true"></span>${state?.name ?? ''}</span>
      <span class="priority priority-${card.priority}" title="Prioridade ${PRIORITY_LABEL[card.priority]}">${icon(PRIORITY_ICON[card.priority], 16)}</span>
      ${card.assignee ? html`<span class="avatar" title="${card.assignee.name}">${initials(card.assignee.name)}</span>` : html`<span class="avatar avatar-empty" aria-hidden="true"></span>`}
    </li>
  `
}

const hint = (context: BoardContext): string => {
  if (!context.canWrite) {
    return ''
  }
  return context.filtered ? ' — limpe os filtros para reordenar' : ' — arraste para reordenar'
}

/** The open cards in one manual order, the top first: what to pick up next (escopo-mvp 3.3). */
export const backlog = (context: BoardContext): Html => {
  const cards = backlogCards(context)
  return html`
    <div class="toolbar">
      <span class="muted">${cards.length} cards abertos, na ordem de prioridade${hint(context)}</span>
    </div>
    ${cards.length ? html`<ol class="backlog" data-backlog>${cards.map((card, index) => row(card, index + 1, context))}</ol>` : html`<p class="empty muted">Nenhum card aberto.</p>`}
  `
}

export const bindBacklog = (root: HTMLElement, context: BoardContext): void => {
  bindOpenCards(root, context)
  const list = root.querySelector<HTMLElement>('[data-backlog]')
  if (!list || !reorders(context)) {
    return
  }
  let dragged: HTMLElement | undefined
  const marker = document.createElement('li')
  marker.className = 'drop-marker'
  const others = () => [...list.querySelectorAll<HTMLElement>('.backlog-row')].filter((each) => each !== dragged)
  const indexAt = (y: number) =>
    dropIndex(
      others().map((each) => each.getBoundingClientRect()),
      y
    )

  list.addEventListener('dragstart', (event) => {
    dragged = (event.target as HTMLElement).closest<HTMLElement>('.backlog-row') ?? undefined
    event.dataTransfer?.setData('text/plain', dragged?.dataset.cardId ?? '')
  })
  list.addEventListener('dragend', () => marker.remove())
  list.addEventListener('dragover', (event) => {
    event.preventDefault()
    list.insertBefore(marker, others()[indexAt(event.clientY)] ?? null)
  })
  list.addEventListener('drop', (event) => {
    event.preventDefault()
    const card = context.cards.find((each) => each.id === dragged?.dataset.cardId)
    marker.remove()
    if (card) {
      write.rankInBacklog(card, indexAt(event.clientY)).catch((refusal: unknown) => {
        toast(refusalSentence(refusal), 'error')
        invalidate(`space:${context.spaceId}:cards`)
      })
    }
  })
}
