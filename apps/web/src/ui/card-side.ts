import type { Card } from '@/api/requests'
import { ESTIMATES, labelColor, PRIORITIES, PRIORITY_LABEL } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { POINTS, planning } from '@/lib/sprints'
import type { BoardContext } from '@/views/board'

import { people } from './card-pickers'
import { customFieldInputs } from './custom-fields'
import { dateField } from './date-picker'
import { type IconName, icon } from './icons'
import { selectField } from './select'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** The groups of the side column a person can fold; which are folded lives on the dialog, across redraws. */
export type SideGroup = 'details' | 'structure' | 'integrations'

type Select = (
  name: string,
  label: string,
  glyph: IconName,
  options: { value: string; label: string }[],
  value: string
) => Html

/** A field the person reads but does not change here: the icon and label, then the value. */
const readField = (label: string, glyph: IconName, value: Html | string): Html =>
  html`<div class="field"><span class="label">${icon(glyph, 16)}${label}</span><span>${value}</span></div>`

const selectOf =
  (canWrite: boolean): Select =>
  (name, label, glyph, options, value) =>
    canWrite
      ? selectField({ name, label, icon: glyph, options, value, attributes: html`data-field="${name}"` })
      : readField(label, glyph, options.find((option) => option.value === value)?.label ?? '—')

/** P/M/G, or story points where the space estimates in them (ADR-0029). */
const estimateField = (card: Card, context: BoardContext, select: Select): Html => {
  if (context.space.estimation !== 'points') {
    const sizes = ESTIMATES.map((size) => ({ value: size, label: size }))
    return select(
      'estimate',
      'Estimativa',
      'clockHour',
      [{ value: '', label: 'Sem estimativa' }, ...sizes],
      card.estimate ?? ''
    )
  }
  const scale = [...new Set([...POINTS, ...(card.points === null ? [] : [card.points])])].sort((a, b) => a - b)
  const options = scale.map((points) => ({ value: String(points), label: String(points) }))
  const value = card.points === null ? '' : String(card.points)
  return select('points', 'Pontos', 'clockHour', [{ value: '', label: 'Sem pontos' }, ...options], value)
}

/** The sprints a card can go to — the active and planned ones — and the closed one it was done in. */
const sprintOptions = (card: Card, context: BoardContext) => {
  const closed = context.sprints.find((sprint) => sprint.id === card.sprintId && sprint.state === 'closed')
  return [
    { value: '', label: 'Backlog' },
    ...planning(context.sprints).map((sprint) => ({
      value: sprint.id,
      label: sprint.state === 'active' ? `${sprint.name} (ativa)` : sprint.name
    })),
    ...(closed ? [{ value: closed.id, label: `${closed.name} (encerrada)` }] : [])
  ]
}

/** The labels as tags; for a writer they are the button that opens the space's labels to tick, as the squad's list. */
const labelsField = (card: Card, context: BoardContext): Html => {
  const canWrite = context.canWrite
  const tags = card.labels.length
    ? card.labels.map(
        (label) =>
          html`<span class="label-tag"><span class="tile-dot type-${labelColor(context.labels, label)}" aria-hidden="true"></span>${label}</span>`
      )
    : html`<span class="muted">Sem labels</span>`
  return html`
    <div class="field labels-field">
      <span class="label" id="card-labels-label">${icon('tag', 16)}Labels</span>
      ${
        canWrite
          ? html`<button type="button" class="labels-tags" data-labels-pick aria-labelledby="card-labels-label" aria-haspopup="dialog">${tags}${icon('chevronDown', 16)}</button>`
          : html`<span class="labels-tags">${tags}</span>`
      }
    </div>
  `
}

/** What the card is and who has it: type, people, priority, size, labels, the due date, the space's own fields. */
const details = (card: Card, context: BoardContext): Html => {
  const select = selectOf(context.canWrite)
  const types = context.workflow.types.map((type) => ({ value: type.id, label: type.name }))
  const priorities = PRIORITIES.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] }))
  return html`
    ${select('typeId', 'Tipo', 'squareRotated', types, card.typeId)}
    ${select('assigneeId', 'Responsável', 'user', people(context), card.assignee?.id ?? '')}
    ${context.canWrite && card.assignee?.id !== context.meId ? html`<button type="button" class="detail-assign" data-assign-me>Atribuir a mim</button>` : ''}
    ${readField('Relator', 'userPlus', card.reporter.name)}
    ${select('priority', 'Prioridade', 'chartBar', priorities, card.priority)}
    ${estimateField(card, context, select)}
    ${labelsField(card, context)}
    ${dateField({ name: 'dueDate', label: 'Data limite', icon: 'calendar', value: card.dueDate, readonly: !context.canWrite, attributes: html`data-due` })}
    <div class="detail-props-custom" data-custom-fields>${customFieldInputs(card, context.fields, context.members, context.canWrite)}</div>
  `
}

/** Where the card sits in the company: its space, the squad that owns it, the sprint it is in. */
const structure = (card: Card, context: BoardContext, squad: Html): Html => html`
  ${readField('Espaço', 'layoutGrid', `${context.spaceKey} · ${context.space.name}`)}
  <div class="field"><span class="label">${icon('usersGroup', 16)}Squad</span>${squad}</div>
  ${context.space.usesSprints ? selectOf(context.canWrite)('sprintId', 'Sprint', 'bolt', sprintOptions(card, context), card.sprintId ?? '') : ''}
`

/**
 * Room for what other tools know about the card. GitHub is out of the MVP (escopo-mvp, "Fora do
 * MVP"), so its row only says so; a connected tool will list its pull requests and commits here.
 */
const integrations = (): Html => html`
  ${readField('GitHub', 'gitPullRequest', html`<span class="muted">Em breve</span>`)}
`

const group = (id: SideGroup, title: string, folded: ReadonlySet<SideGroup>, body: Html): Html => html`
  <details class="side-group" data-side-group="${id}" ${folded.has(id) ? '' : html`open`}>
    <summary class="side-group-title">${title}${icon('chevronDown', 14)}</summary>
    <div class="detail-props">${body}</div>
  </details>
`

/**
 * What a person does to the card, above its fields: the state as a button — the most frequent change —
 * and moving the card to another space.
 */
const toolbar = (card: Card, context: BoardContext): Html => {
  const state = context.workflow.states.find((each) => each.id === card.stateId)
  if (!context.canWrite) {
    return html`<div class="detail-toolbar"><span class="status-pill status-${state?.group ?? 'not_started'}">${state?.name ?? '—'}</span></div>`
  }
  const options = context.workflow.states.map((each) => ({ value: each.id, label: each.name }))
  return html`
    <div class="detail-toolbar">
      <div class="status-select status-${state?.group ?? 'not_started'}">
        ${selectField({ name: 'stateId', label: 'Estado', visibleLabel: false, options, value: card.stateId, attributes: html`data-field="stateId"` })}
      </div>
      <button type="button" class="button button-secondary button-icon" data-transfer aria-label="Mover para outro espaço" title="Mover para outro espaço">${icon('arrowsRightLeft', 16)}</button>
    </div>
  `
}

const meta = (card: Card): Html => html`
  <ul class="detail-meta">
    <li>${icon('clock', 14)}Criado em ${WHEN.format(new Date(card.createdAt))}</li>
    <li>${icon('history', 14)}Atualizado em ${WHEN.format(new Date(card.updatedAt))}</li>
  </ul>
`

/**
 * The side column: the state, then the fields in groups a person can fold — the card's details, where
 * it sits, what other tools know — and when the card was born.
 */
export const side = (card: Card, context: BoardContext, squad: Html, folded: ReadonlySet<SideGroup>): Html => html`
  <aside class="detail-side">
    ${toolbar(card, context)}
    ${group('details', 'Detalhes', folded, details(card, context))}
    ${group('structure', 'Estrutura do espaço', folded, structure(card, context, squad))}
    ${group('integrations', 'Integrações', folded, integrations())}
    ${meta(card)}
  </aside>
`

/** Folding a group is remembered across redraws. */
export const bindSide = (root: HTMLElement, fold: (group: SideGroup, folded: boolean) => void): void => {
  for (const each of root.querySelectorAll<HTMLDetailsElement>('[data-side-group]')) {
    each.addEventListener('toggle', () => fold(each.dataset.sideGroup as SideGroup, !each.open))
  }
}
