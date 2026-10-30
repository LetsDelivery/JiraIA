import type { Card, CardChanges } from '@/api/requests'
import { ESTIMATES, labelColor, PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/cards'
import { html } from '@/lib/html'
import { POINTS } from '@/lib/sprints'
import type { BoardContext } from '@/views/board'

import { avatar } from './avatar'
import { openCalendar } from './date-picker'
import { icon } from './icons'
import { openPicker, type PickerItem } from './picker'

/** Writes the change the person picked; the caller draws the card again from the answer. */
export type Save = (changes: CardChanges) => void

/** The space's active people a card can be given to, with "Sem responsável" first. */
export const people = (context: Pick<BoardContext, 'members'>) => [
  { value: '', label: 'Sem responsável' },
  ...context.members
    .filter((member) => member.status === 'active' && member.kind === 'person')
    .map((member) => ({ value: member.id, label: member.name }))
]

const assigneeItems = (context: BoardContext): PickerItem[] =>
  people(context).map((person) => ({
    ...person,
    lead: person.value
      ? avatar({ id: person.value, name: person.label })
      : html`<span class="avatar avatar-empty">${icon('user', 12)}</span>`
  }))

export const pickAssignee = (anchor: HTMLElement, card: Card, context: BoardContext, save: Save): void =>
  openPicker({
    anchor,
    label: 'Responsável',
    items: assigneeItems(context),
    chosen: [card.assignee?.id ?? ''],
    choose: ([value]) => save({ assigneeId: value || null })
  })

export const pickPriority = (anchor: HTMLElement, card: Card, save: Save): void =>
  openPicker({
    anchor,
    label: 'Prioridade',
    items: PRIORITIES.map((priority) => ({
      value: priority,
      label: PRIORITY_LABEL[priority],
      lead: html`<span class="priority priority-${priority}">${icon(PRIORITY_ICON[priority], 16)}</span>`
    })),
    chosen: [card.priority],
    choose: ([value]) => save({ priority: value as Card['priority'] })
  })

/** P/M/G, or story points where the space estimates in them (ADR-0029). */
export const pickEstimate = (anchor: HTMLElement, card: Card, context: BoardContext, save: Save): void => {
  const points = context.space.estimation === 'points'
  const sizes = points ? POINTS.map(String) : [...ESTIMATES]
  openPicker({
    anchor,
    label: points ? 'Pontos' : 'Estimativa',
    items: [
      { value: '', label: points ? 'Sem pontos' : 'Sem estimativa' },
      ...sizes.map((size) => ({ value: size, label: size }))
    ],
    chosen: [String((points ? card.points : card.estimate) ?? '')],
    choose: ([value]) =>
      save(points ? { points: value ? Number(value) : null } : { estimate: (value || null) as Card['estimate'] })
  })
}

/** Ticks the space's labels on and off, or creates one by typing it; applied when the list closes. */
export const pickLabels = (anchor: HTMLElement, card: Card, context: BoardContext, save: Save): void =>
  openPicker({
    anchor,
    label: 'Labels',
    items: [...new Set([...context.labels.map((label) => label.name), ...card.labels])].map((name) => ({
      value: name,
      label: name,
      lead: html`<span class="tile-dot type-${labelColor(context.labels, name)}" aria-hidden="true"></span>`
    })),
    chosen: card.labels,
    multiple: true,
    create: (text) => text.slice(0, 60),
    choose: (labels) => save({ labels })
  })

export const pickDue = (anchor: HTMLElement, card: Card, save: Save): void =>
  openCalendar(anchor, card.dueDate, (dueDate) => save({ dueDate }))
