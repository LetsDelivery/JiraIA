import { type Card, write } from '@/api/requests'
import type { Sprint } from '@/api/sprints'
import { sprintsWrite } from '@/api/sprints'
import { invalidate } from '@/lib/cache'
import { dropIndex } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { activeSprint, period, planning, remaining, tally, tallyText } from '@/lib/sprints'
import { icon } from '@/ui/icons'
import { openCloseSprint, openCreateSprint, openEditSprint, openStartSprint } from '@/ui/sprint-dialogs'
import { toast } from '@/ui/toast'

import { backlogRow, isOpen } from './backlog'
import { type BoardContext, bindOpenCards } from './board'

/**
 * The backlog of a space that plans in sprints (escopo-mvp 3.11, ADR-0029): a section per active and
 * planned sprint, the backlog below, and cards dragged between them. A cancelled card is in none.
 */

const usesPoints = (context: BoardContext): boolean => context.space.estimation === 'points'

const byRank = (a: Card, b: Card) => a.backlogRank - b.backlogRank || a.number - b.number

/** The cards a sprint section lists: everything in the sprint but the cancelled, done ones included. */
const inSprint = (context: BoardContext, sprint: Sprint): Card[] => {
  const cancelled = new Set(
    context.workflow.states.filter((state) => state.group === 'cancelled').map((state) => state.id)
  )
  return context.cards.filter((card) => card.sprintId === sprint.id && !cancelled.has(card.stateId)).sort(byRank)
}

/** The backlog section: open cards in no sprint that is still planned or running. */
const unplanned = (context: BoardContext): Card[] => {
  const live = new Set(planning(context.sprints).map((sprint) => sprint.id))
  return context.cards
    .filter((card) => isOpen(context, card) && !(card.sprintId && live.has(card.sprintId)))
    .sort(byRank)
}

const sprintActions = (context: BoardContext, sprint: Sprint): Html => {
  if (!context.canWrite) {
    return html``
  }
  const running = activeSprint(context.sprints)
  return html`
    <div class="sprint-actions">
      ${sprint.state === 'planned' && !running ? html`<button type="button" class="button button-primary button-small" data-start-sprint="${sprint.id}">Iniciar sprint</button>` : ''}
      ${sprint.state === 'active' ? html`<button type="button" class="button button-secondary button-small" data-close-sprint="${sprint.id}">Encerrar sprint</button>` : ''}
      <button type="button" class="button button-ghost button-icon button-small" data-edit-sprint="${sprint.id}" aria-label="Editar ${sprint.name}" title="Editar">${icon('pencil', 16)}</button>
      ${sprint.state === 'planned' ? html`<button type="button" class="button button-ghost button-icon button-small" data-delete-sprint="${sprint.id}" aria-label="Excluir ${sprint.name}" title="Excluir">${icon('trash', 16)}</button>` : ''}
    </div>
  `
}

const sprintHead = (context: BoardContext, sprint: Sprint, cards: readonly Card[]): Html => {
  const left = sprint.state === 'active' ? remaining(sprint) : undefined
  return html`
    <header class="sprint-head">
      <div class="sprint-title">
        <h3>${sprint.name}</h3>
        <span class="sprint-badge sprint-${sprint.state}">${sprint.state === 'active' ? 'Ativa' : 'Planejada'}</span>
        <span class="muted">${period(sprint)}</span>
        ${left ? html`<span class="${left.late ? 'sprint-late' : 'muted'}">· ${left.text}</span>` : ''}
        <span class="muted">· ${tallyText(tally(cards, context.workflow.states), usesPoints(context))}</span>
      </div>
      ${sprintActions(context, sprint)}
      ${sprint.goal ? html`<p class="sprint-goal">${sprint.goal}</p>` : ''}
    </header>
  `
}

const cardList = (context: BoardContext, cards: readonly Card[], sprintId: string, empty: string): Html =>
  html`<ol class="backlog" data-drop-sprint="${sprintId}">${
    cards.length
      ? cards.map((card, index) => backlogRow(card, index + 1, context))
      : html`<li class="backlog-empty muted">${empty}</li>`
  }</ol>`

const sprintSection = (context: BoardContext, sprint: Sprint): Html => {
  const cards = inSprint(context, sprint)
  return html`
    <section class="sprint-section" aria-label="${sprint.name}">
      ${sprintHead(context, sprint, cards)}
      ${cardList(context, cards, sprint.id, 'Arraste cards do backlog para planejar esta sprint.')}
    </section>
  `
}

export const sprintPlanning = (context: BoardContext): Html => {
  const rest = unplanned(context)
  return html`
    <div class="toolbar">
      <span class="muted">${context.canWrite ? 'Arraste cards entre as sprints e o backlog' : 'Sprints e backlog do espaço'}</span>
      ${context.canWrite ? html`<button type="button" class="button button-primary" data-create-sprint>${icon('plus')}Criar sprint</button>` : ''}
    </div>
    <div class="sprint-planning">
      ${planning(context.sprints).map((sprint) => sprintSection(context, sprint))}
      <section class="sprint-section" aria-label="Backlog">
        <header class="sprint-head"><div class="sprint-title"><h3>Backlog</h3><span class="muted">· ${tallyText(tally(rest, context.workflow.states), usesPoints(context))}</span></div></header>
        ${cardList(context, rest, '', 'Nenhum card aberto fora das sprints.')}
      </section>
    </div>
  `
}

const sprintOf = (context: BoardContext, id: string | undefined) => context.sprints.find((sprint) => sprint.id === id)

const bindSprintButtons = (root: HTMLElement, context: BoardContext): void => {
  const on = (attribute: string, act: (sprint: Sprint) => void) => {
    for (const button of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      button.addEventListener('click', () => {
        const sprint = sprintOf(context, button.getAttribute(attribute) ?? undefined)
        return sprint ? act(sprint) : undefined
      })
    }
  }
  const points = usesPoints(context)
  const states = context.workflow.states
  root.querySelector('[data-create-sprint]')?.addEventListener('click', () => openCreateSprint(context.spaceId))
  on('data-edit-sprint', (sprint) => openEditSprint(sprint))
  on('data-start-sprint', (sprint) => openStartSprint(sprint, inSprint(context, sprint), states, points))
  on('data-close-sprint', (sprint) =>
    openCloseSprint(sprint, {
      cards: inSprint(context, sprint),
      states,
      points,
      nextPlanned: planning(context.sprints).find((each) => each.state === 'planned')
    })
  )
  on(
    'data-delete-sprint',
    (sprint) =>
      void sprintsWrite
        .remove(sprint)
        .then(() => toast(`${sprint.name} excluída; os cards voltaram ao backlog.`), refuse)
  )
}

const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')

/** The order every open card keeps, which a drop inside a section is translated into. */
const globalIndex = (context: BoardContext, list: HTMLElement, local: number, dragged: string): number => {
  const all = context.cards.filter((card) => isOpen(context, card) && card.id !== dragged).sort(byRank)
  const rows = [...list.querySelectorAll<HTMLElement>('.backlog-row')].filter((row) => row.dataset.cardId !== dragged)
  const neighbour = rows[local]?.dataset.cardId
  const last = rows.at(-1)?.dataset.cardId
  if (neighbour) {
    return Math.max(
      0,
      all.findIndex((card) => card.id === neighbour)
    )
  }
  return last ? all.findIndex((card) => card.id === last) + 1 : all.length
}

/** A drop in another section changes the card's sprint; in the same one, its place in the order. */
const dropCard = (context: BoardContext, card: Card, list: HTMLElement, local: number): Promise<unknown> => {
  const sprintId = list.dataset.dropSprint || null
  const here = card.sprintId && sprintOf(context, card.sprintId)?.state !== 'closed' ? card.sprintId : null
  if (sprintId !== here) {
    return write.updateCard(card, { sprintId })
  }
  return context.filtered ? Promise.resolve() : write.rankInBacklog(card, globalIndex(context, list, local, card.id))
}

const bindDrag = (root: HTMLElement, context: BoardContext): void => {
  let dragged: string | undefined
  const marker = document.createElement('li')
  marker.className = 'drop-marker'
  const rows = (list: HTMLElement) =>
    [...list.querySelectorAll<HTMLElement>('.backlog-row')].filter((row) => row.dataset.cardId !== dragged)
  const indexAt = (list: HTMLElement, y: number) =>
    dropIndex(
      rows(list).map((row) => row.getBoundingClientRect()),
      y
    )

  root.addEventListener('dragstart', (event) => {
    dragged = (event.target as HTMLElement).closest<HTMLElement>('.backlog-row')?.dataset.cardId
    event.dataTransfer?.setData('text/plain', dragged ?? '')
  })
  root.addEventListener('dragend', () => marker.remove())
  root.querySelectorAll<HTMLElement>('[data-drop-sprint]').forEach((list) => {
    list.addEventListener('dragover', (event) => {
      event.preventDefault()
      list.insertBefore(marker, rows(list)[indexAt(list, event.clientY)] ?? null)
    })
    list.addEventListener('drop', (event) => {
      event.preventDefault()
      marker.remove()
      const card = context.cards.find((each) => each.id === dragged)
      if (card) {
        dropCard(context, card, list, indexAt(list, event.clientY)).catch((refusal: unknown) => {
          refuse(refusal)
          invalidate(`space:${context.spaceId}:cards`)
        })
      }
    })
  })
}

export const bindSprintPlanning = (root: HTMLElement, context: BoardContext): void => {
  bindOpenCards(root, context)
  bindSprintButtons(root, context)
  if (context.canWrite) {
    bindDrag(root, context)
  }
}
