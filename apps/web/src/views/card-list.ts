import type { Card, Field } from '@/api/requests'
import { invalidate } from '@/lib/cache'
import { PRIORITY_LABEL } from '@/lib/cards'
import {
  COLUMN_LABEL,
  DEFAULT_COLUMNS,
  STANDARD_COLUMNS,
  type StandardColumn,
  sortRows,
  toggleColumn
} from '@/lib/columns'
import { shortDate } from '@/lib/dates'
import { type Html, html } from '@/lib/html'
import { OLD_DONE_DAYS, oldDoneHref, showsAllDone } from '@/lib/old-done'
import { planning } from '@/lib/sprints'
import { persistedStore } from '@/lib/store'
import { bindBulkBar, bulkBar, selectionOf } from '@/ui/bulk-bar'
import { icon } from '@/ui/icons'

import { type BoardContext, bindOpenCards } from './board'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** Which columns show, per space, and the sort — a viewer's preference on this browser. */
const shownColumns = persistedStore<Record<string, string[]>>('jiraia.list.columns', {})
let sort: { column: string; descending: boolean } = { column: 'key', descending: false }

export const columnsOf = (spaceId: string): string[] => shownColumns.get()[spaceId] ?? [...DEFAULT_COLUMNS]

/** A saved view opens with its own columns (3.5). */
export const setColumns = (spaceId: string, columns: readonly string[]): void => {
  shownColumns.set({ ...shownColumns.get(), [spaceId]: [...columns] })
}
const offered = (fields: readonly Field[]): string[] => [
  ...STANDARD_COLUMNS,
  ...fields.map((field) => `field:${field.id}`)
]

const labelOf = (column: string, fields: readonly Field[]): string =>
  column.startsWith('field:')
    ? (fields.find((field) => field.id === column.slice(6))?.name ?? '')
    : COLUMN_LABEL[column as StandardColumn]

const customText = (card: Card, field: Field | undefined, context: BoardContext): string => {
  const value = field ? card.customFields[field.id] : undefined
  if (value === undefined || value === null) {
    return ''
  }
  if (field?.kind === 'person') {
    return context.members.find((member) => member.id === value)?.name ?? ''
  }
  if (field?.kind === 'date') {
    return shortDate(String(value))
  }
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/** What a cell shows, as text — the same text the sort compares. */
const cellText = (card: Card, column: string, context: BoardContext): string => {
  const texts: Record<StandardColumn, () => string> = {
    key: () => card.key,
    title: () => card.title,
    type: () => context.workflow.types.find((type) => type.id === card.typeId)?.name ?? '',
    state: () => context.workflow.states.find((state) => state.id === card.stateId)?.name ?? '',
    assignee: () => card.assignee?.name ?? '',
    reporter: () => card.reporter.name,
    priority: () => PRIORITY_LABEL[card.priority],
    labels: () => card.labels.join(', '),
    dueDate: () => (card.dueDate ? shortDate(card.dueDate) : ''),
    estimate: () => card.estimate ?? '',
    createdAt: () => WHEN.format(new Date(card.createdAt)),
    updatedAt: () => WHEN.format(new Date(card.updatedAt))
  }
  return column.startsWith('field:')
    ? customText(
        card,
        context.fields.find((field) => field.id === column.slice(6)),
        context
      )
    : (texts[column as StandardColumn]?.() ?? '')
}

/** Keys and dates read as data: monospace, tabular (design-principles). */
const DATA_COLUMNS = new Set(['key', 'dueDate', 'createdAt', 'updatedAt'])

const cell = (card: Card, column: string, context: BoardContext): Html => {
  const text = cellText(card, column, context)
  if (column === 'title') {
    return html`<td><button type="button" class="link card-open-inline" data-open-card="${card.id}">${text}</button></td>`
  }
  return html`<td class="${DATA_COLUMNS.has(column) ? 'data' : ''}">${text || html`<span class="faint">—</span>`}</td>`
}

const header = (column: string, fields: readonly Field[]): Html => {
  const sorted = sort.column === column
  const direction = sorted ? (sort.descending ? 'descending' : 'ascending') : 'none'
  return html`<th aria-sort="${direction}"><button type="button" class="th-sort" data-sort="${column}">${labelOf(column, fields)}
    ${sorted ? icon(sort.descending ? 'arrowDown' : 'arrowUp', 14) : ''}</button></th>`
}

const picker = (context: BoardContext, shown: readonly string[]): Html => html`
  <details class="column-picker">
    <summary class="button button-secondary">${icon('columns', 16)}Colunas</summary>
    <div class="select-menu glass column-menu" role="group" aria-label="Colunas da lista">
      ${offered(context.fields).map(
        (column) =>
          html`<button type="button" class="chip chip-toggle" data-column="${column}" aria-pressed="${shown.includes(column)}">${labelOf(column, context.fields)}</button>`
      )}
    </div>
  </details>
`

const bulkContext = (context: BoardContext) => {
  const selected = selectionOf(context.spaceId)
  const here = new Set(context.cards.map((card) => card.id))
  for (const id of [...selected].filter((each) => !here.has(each))) {
    selected.delete(id)
  }
  return {
    spaceId: context.spaceId,
    states: context.workflow.states,
    members: context.members,
    sprints: planning(context.sprints),
    selected
  }
}

/** A box per row to pick cards for a change to all of them (3.8); the head box picks every row. */
const tick = (card: Card | undefined, selected: ReadonlySet<string>, total: number): Html =>
  card
    ? html`<td class="tick"><input type="checkbox" data-tick="${card.id}" aria-label="Selecionar ${card.key}" ${selected.has(card.id) ? html`checked` : ''} /></td>`
    : html`<th class="tick"><input type="checkbox" data-tick-all aria-label="Selecionar todos" ${total > 0 && selected.size === total ? html`checked` : ''} /></th>`

/** Says the old done cards are left out, and how to see them; or, once shown, how to leave them out. */
const oldDoneNote = (context: BoardContext): Html => {
  const here = `${location.pathname}${location.search}`
  if (context.oldDone) {
    const { hidden } = context.oldDone
    return hidden === 0
      ? html``
      : html` · ${hidden === null ? '' : `${hidden} `}concluídos há mais de ${OLD_DONE_DAYS} dias ocultos · <a class="link" href="${oldDoneHref(here, true)}">Mostrar todos</a>`
  }
  return showsAllDone(location.search)
    ? html` · <a class="link" href="${oldDoneHref(here, false)}">Ocultar concluídos há mais de ${OLD_DONE_DAYS} dias</a>`
    : html``
}

/** The cards as a table with the columns the viewer picks, sortable by any of them (escopo-mvp 3.2). */
export const cardList = (context: BoardContext): Html => {
  const shown = columnsOf(context.spaceId).filter((column) => offered(context.fields).includes(column))
  const rows = sortRows(context.cards, (card) => cellText(card, sort.column, context), sort.descending)
  const bulk = bulkContext(context)
  const ticks = (card?: Card) => (context.canWrite ? tick(card, bulk.selected, rows.length) : '')
  return html`
    <div class="toolbar">
      <span class="muted">${context.cards.length} cards${oldDoneNote(context)}</span>
      ${picker(context, shown)}
    </div>
    ${context.canWrite ? bulkBar(bulk) : ''}
    <div class="table-scroll">
      <table class="table card-table">
        <thead><tr>${ticks()}${shown.map((column) => header(column, context.fields))}</tr></thead>
        <tbody>${rows.map((card) => html`<tr>${ticks(card)}${shown.map((column) => cell(card, column, context))}</tr>`)}</tbody>
      </table>
    </div>
  `
}

const bindTicks = (root: HTMLElement, context: BoardContext): void => {
  const bulk = bulkContext(context)
  const redraw = () => invalidate('list:selection')
  root.querySelector('[data-tick-all]')?.addEventListener('change', (event) => {
    const all = (event.target as HTMLInputElement).checked
    bulk.selected.clear()
    for (const card of all ? context.cards : []) {
      bulk.selected.add(card.id)
    }
    redraw()
  })
  for (const box of root.querySelectorAll<HTMLInputElement>('[data-tick]')) {
    box.addEventListener('change', () => {
      const id = box.dataset.tick ?? ''
      box.checked ? bulk.selected.add(id) : bulk.selected.delete(id)
      redraw()
    })
  }
  bindBulkBar(root, bulk, redraw)
}

export const bindCardList = (root: HTMLElement, context: BoardContext): void => {
  bindOpenCards(root, context)
  if (context.canWrite) {
    bindTicks(root, context)
  }
  const redraw = () => invalidate(`space:${context.spaceId}:cards`)
  for (const button of root.querySelectorAll<HTMLElement>('[data-sort]')) {
    button.addEventListener('click', () => {
      const column = button.dataset.sort ?? 'key'
      sort = { column, descending: sort.column === column && !sort.descending }
      redraw()
    })
  }
  for (const chip of root.querySelectorAll<HTMLElement>('[data-column]')) {
    chip.addEventListener('click', () => {
      const next = toggleColumn(columnsOf(context.spaceId), chip.dataset.column ?? '', offered(context.fields))
      shownColumns.set({ ...shownColumns.get(), [context.spaceId]: next })
      chip.setAttribute('aria-pressed', String(next.includes(chip.dataset.column ?? '')))
    })
  }
  root.querySelector('.column-picker')?.addEventListener('toggle', (event) => {
    if (!(event.target as HTMLDetailsElement).open) {
      redraw()
    }
  })
}
