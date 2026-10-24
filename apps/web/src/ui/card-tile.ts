import { type Card, type CardType, type Label, write } from '@/api/requests'
import { initials, labelColor, PRIORITY_ICON, PRIORITY_LABEL, type StateGroup } from '@/lib/cards'
import { dayMonth, isPast, shortDate } from '@/lib/dates'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import type { BoardContext } from '@/views/board'

import { pickAssignee, pickDue, pickEstimate, pickLabels, pickPriority, type Save } from './card-pickers'
import { icon } from './icons'
import { toast } from './toast'
import { typeIcon } from './type-look'

type Edit = 'priority' | 'due' | 'estimate' | 'labels' | 'assignee'

/**
 * One property on the tile: a button that edits it where the card can be written, plain text where it
 * cannot. `label` names it for assistive tech and as its tooltip.
 */
const prop = (canWrite: boolean, edit: Edit, label: string, body: Html, tone = ''): Html =>
  canWrite
    ? html`<button type="button" class="tile-prop ${tone}" data-tile-edit="${edit}" aria-label="${label}" title="${label}">${body}</button>`
    : html`<span class="tile-prop ${tone}" title="${label}">${body}</span>`

/** A due date still open past its day reads in the accent; a finished card's never does. */
const dueProp = (card: Card, group: StateGroup, canWrite: boolean): Html => {
  if (!card.dueDate) {
    return canWrite ? prop(true, 'due', 'Data limite: sem data', icon('calendar', 14), 'is-empty') : html``
  }
  const late = isPast(card.dueDate) && group !== 'done' && group !== 'cancelled'
  const body = html`${icon('calendar', 14)}${dayMonth(card.dueDate)}`
  return prop(canWrite, 'due', `Data limite: ${shortDate(card.dueDate)}`, body, late ? 'is-late' : '')
}

/** P/M/G or story points, whichever the space estimates in (ADR-0029). */
const estimateProp = (card: Card, canWrite: boolean): Html => {
  const size = card.points ?? card.estimate
  if (size === null || size === undefined) {
    return canWrite ? prop(true, 'estimate', 'Estimativa: sem estimativa', icon('clockHour', 14), 'is-empty') : html``
  }
  return prop(canWrite, 'estimate', `Estimativa: ${size}`, html`${icon('clockHour', 14)}${String(size)}`)
}

/** A label's dot, in its colour from the space's catalogue (ADR-0032). */
const dot = (labels: readonly Label[], name: string): Html =>
  html`<span class="tile-dot type-${labelColor(labels, name)}" aria-hidden="true"></span>`

/** One label by its name; several as how many, with up to three dots, all of them in the tooltip. */
const labelProp = (card: Card, canWrite: boolean, labels: readonly Label[]): Html => {
  const [first, ...rest] = card.labels
  if (!first) {
    return canWrite ? prop(true, 'labels', 'Labels: nenhuma', icon('tag', 14), 'is-empty') : html``
  }
  const text = rest.length ? `${card.labels.length} labels` : first
  const body = html`<span class="tile-dots">${card.labels.slice(0, 3).map((name) => dot(labels, name))}</span><span class="tile-label-text">${text}</span>`
  return prop(canWrite, 'labels', `Labels: ${card.labels.join(', ')}`, body, 'tile-label')
}

const assigneeProp = (card: Card, canWrite: boolean): Html => {
  const body = card.assignee
    ? html`<span class="avatar">${initials(card.assignee.name)}</span>`
    : html`<span class="avatar avatar-empty">${icon('user', 14)}</span>`
  const label = `Responsável: ${card.assignee?.name ?? 'ninguém'}`
  return card.assignee || canWrite ? prop(canWrite, 'assignee', label, body, 'tile-assignee') : html``
}

/**
 * A card on the board: its key and title, which open it, then the properties a person scans for —
 * priority, due date, estimate, labels, who has it — each a chip that changes it right there.
 */
/** What a tile needs from its board: whether the card can change, its column's group, the space's labels, its type. */
export type TileLook = { canWrite: boolean; group: StateGroup; labels: readonly Label[]; type: CardType | undefined }

export const tile = (card: Card, { canWrite, group, labels, type }: TileLook): Html => html`
  <li class="card-tile" data-card-id="${card.id}" ${canWrite ? html`draggable="true"` : ''}
    data-search="${`${card.key} ${card.title}`.toLowerCase()}" data-assignee="${card.assignee?.id ?? ''}">
    <button type="button" class="card-open" data-open-card="${card.id}">
      <span class="card-tile-head">
        ${type ? typeIcon(type, 14) : ''}
        <span class="card-key">${card.key}</span>
        ${card.parentId ? html`<span class="faint" title="Subtarefa">${icon('subtask', 14)}</span>` : ''}
      </span>
      <span class="card-tile-title">${card.title}</span>
    </button>
    <div class="card-tile-props" role="group" aria-label="Propriedades de ${card.key}">
      ${prop(canWrite, 'priority', `Prioridade: ${PRIORITY_LABEL[card.priority]}`, html`<span class="priority priority-${card.priority}">${icon(PRIORITY_ICON[card.priority], 14)}</span>`)}
      ${dueProp(card, group, canWrite)}
      ${estimateProp(card, canWrite)}
      ${labelProp(card, canWrite, labels)}
      ${assigneeProp(card, canWrite)}
    </div>
  </li>
`

const PICKERS: Record<Edit, (anchor: HTMLElement, card: Card, context: BoardContext, save: Save) => void> = {
  priority: (anchor, card, _context, save) => pickPriority(anchor, card, save),
  due: (anchor, card, _context, save) => pickDue(anchor, card, save),
  estimate: pickEstimate,
  labels: pickLabels,
  assignee: pickAssignee
}

/**
 * A tile's chip opens its picker; the choice is written and the board draws itself again from the
 * cache. Listens on each tile's chips, which every redraw replaces, so listeners never pile up.
 */
export const bindTileEdits = (root: HTMLElement, context: BoardContext): void => {
  for (const group of root.querySelectorAll<HTMLElement>('.card-tile-props')) {
    const card = context.cards.find((each) => each.id === group.closest<HTMLElement>('.card-tile')?.dataset.cardId)
    group.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-tile-edit]')
      if (button && card) {
        PICKERS[button.dataset.tileEdit as Edit](button, card, context, saveOf(card))
      }
    })
  }
}

const saveOf =
  (card: Card): Save =>
  (changes) =>
    void write.updateCard(card, changes).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
