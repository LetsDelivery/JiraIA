import type { Card, State } from '@/api/requests'
import type { Sprint } from '@/api/sprints'
import { withParams } from '@/lib/filters'
import { type Html, html } from '@/lib/html'
import { navigate } from '@/lib/router'
import { activeSprint, period, planning, remaining, tally, tallyText } from '@/lib/sprints'

import { selectField } from './select'
import { openCloseSprint } from './sprint-dialogs'

/** What a sprint board needs to know of its space. */
export type SprintScope = {
  sprints: readonly Sprint[]
  cards: readonly Card[]
  states: readonly State[]
  points: boolean
  canWrite: boolean
}

/** `?sprint=` asks for every card. */
export const ALL = 'todos'

/**
 * The sprint the board shows (ADR-0029): the one named in `?sprint=`, else the active one. `undefined`
 * shows every card — asked for, or because no sprint is running.
 */
export const shownSprint = (sprints: readonly Sprint[], asked: string | null): Sprint | undefined =>
  asked === ALL ? undefined : (sprints.find((sprint) => sprint.id === asked) ?? activeSprint(sprints))

const pickerOptions = (sprints: readonly Sprint[]) => {
  const closed = sprints.filter((sprint) => sprint.state === 'closed').sort((a, b) => b.number - a.number)
  const label = (sprint: Sprint) =>
    `${sprint.name}${sprint.state === 'active' ? ' (ativa)' : sprint.state === 'closed' ? ' (encerrada)' : ''}`
  return [
    ...[...planning(sprints), ...closed].map((sprint) => ({ value: sprint.id, label: label(sprint) })),
    { value: ALL, label: 'Todos os cards' }
  ]
}

const summary = (scope: SprintScope, sprint: Sprint): Html => {
  const left = sprint.state === 'active' ? remaining(sprint) : undefined
  return html`
    <div class="sprint-strip-text">
      <strong>${sprint.name}</strong>
      <span class="muted">${period(sprint)}</span>
      ${left ? html`<span class="${left.late ? 'sprint-late' : 'muted'}">· ${left.text}</span>` : ''}
      <span class="muted">· ${tallyText(tally(scope.cards, scope.states), scope.points)}</span>
      ${sprint.goal ? html`<p class="sprint-goal">${sprint.goal}</p>` : ''}
    </div>
  `
}

/** Above the board of a space with sprints: which sprint is on screen, how it goes, and closing it. */
export const sprintStrip = (scope: SprintScope, sprint: Sprint | undefined): Html => {
  if (scope.sprints.length === 0) {
    return html`<p class="sprint-strip muted">Nenhuma sprint ainda. Crie e planeje a primeira na aba Backlog.</p>`
  }
  return html`
    <div class="sprint-strip">
      ${selectField({ name: 'sprint', label: 'Sprint no board', visibleLabel: false, options: pickerOptions(scope.sprints), value: sprint?.id ?? ALL, attributes: html`data-sprint-picker` })}
      ${sprint ? summary(scope, sprint) : html`<span class="muted">${activeSprint(scope.sprints) ? 'Todos os cards do espaço' : 'Nenhuma sprint ativa: todos os cards do espaço'}</span>`}
      ${sprint?.state === 'active' && scope.canWrite ? html`<button type="button" class="button button-secondary" data-close-sprint>Encerrar sprint</button>` : ''}
    </div>
  `
}

export const bindSprintStrip = (root: HTMLElement, scope: SprintScope, sprint: Sprint | undefined): void => {
  root.querySelector('[data-sprint-picker]')?.addEventListener('select-change', (event) => {
    const value = (event as CustomEvent<{ value: string }>).detail.value
    navigate(
      withParams(`${location.pathname}${location.search}`, {
        sprint: value === activeSprint(scope.sprints)?.id ? undefined : value
      })
    )
  })
  root.querySelector('[data-close-sprint]')?.addEventListener('click', () => {
    if (sprint) {
      const nextPlanned = planning(scope.sprints).find((each) => each.state === 'planned')
      openCloseSprint(sprint, { cards: scope.cards, states: scope.states, points: scope.points, nextPlanned })
    }
  })
}
