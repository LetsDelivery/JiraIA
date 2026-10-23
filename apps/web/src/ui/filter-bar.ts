import type { Field, Member, SavedView, Workflow } from '@/api/requests'
import { invalidate } from '@/lib/cache'
import { PRIORITIES, PRIORITY_LABEL, parseLabels } from '@/lib/cards'
import {
  type CardFilter,
  conditionCount,
  DUE_CHOICES,
  dueChoice,
  dueRange,
  filterParam,
  has,
  hasField,
  isEmpty,
  type ListKey,
  PERIODS,
  toggleField,
  toggleValue,
  withCondition,
  withParams
} from '@/lib/filters'
import { type Html, html } from '@/lib/html'

import { icon } from './icons'

export type FilterContext = {
  spaceId: string
  workflow: Workflow
  members: readonly Member[]
  assignable: ReadonlySet<string>
  fields: readonly Field[]
  filter: CardFilter
}

/** Whether the panel was open, so a click on a chip — which draws the screen again — keeps it open. */
let pickerOpen = false

type Chip = { label: string; pressed: boolean; data: Html }

const chips = (title: string, items: readonly Chip[]): Html =>
  items.length === 0
    ? html``
    : html`
      <div class="filter-group" role="group" aria-label="${title}">
        <p class="label">${title}</p>
        <div class="chips">${items.map(
          (item) =>
            html`<button type="button" class="chip chip-toggle" aria-pressed="${item.pressed}" ${item.data}>${item.label}</button>`
        )}</div>
      </div>
    `

const listChips = (filter: CardFilter, key: ListKey, options: readonly { value: string; label: string }[]) =>
  options.map((option) => ({
    label: option.label,
    pressed: has(filter, key, option.value),
    data: html`data-chip="list" data-key="${key}" data-value="${option.value}"`
  }))

const people = (context: FilterContext) => [
  { value: 'me', label: 'Eu' },
  { value: 'none', label: 'Sem responsável' },
  ...context.members
    .filter((member) => member.status === 'active' && member.kind === 'person' && context.assignable.has(member.id))
    .map((member) => ({ value: member.id, label: member.name }))
]

const periodChips = (key: 'created' | 'updated', filter: CardFilter): Chip[] =>
  PERIODS.filter((period) => period.value).map((period) => ({
    label: period.label,
    pressed: filter[key]?.from === period.value,
    data: html`data-chip="period" data-key="${key}" data-value="${period.value}"`
  }))

const dueChips = (filter: CardFilter): Chip[] =>
  DUE_CHOICES.filter((choice) => choice.value).map((choice) => ({
    label: choice.label,
    pressed: dueChoice(filter.due) === choice.value,
    data: html`data-chip="due" data-value="${choice.value}"`
  }))

const movedChips = (context: FilterContext): Html => {
  const moved = context.filter.movedTo
  const states = context.workflow.states.map((state) => ({
    label: state.name,
    pressed: moved?.stateIds.includes(state.id) ?? false,
    data: html`data-chip="moved-state" data-value="${state.id}"`
  }))
  const periods = moved
    ? PERIODS.filter((period) => period.value).map((period) => ({
        label: period.label,
        pressed: moved.after === period.value,
        data: html`data-chip="moved-after" data-value="${period.value}"`
      }))
    : []
  return html`${chips('Mudou para o estado', states)}${chips('Mudou quando', periods)}`
}

const fieldChips = (context: FilterContext): Html =>
  html`${context.fields
    .filter((field) => field.kind === 'select' || field.kind === 'multi_select')
    .map((field) =>
      chips(
        field.name,
        field.options.map((option) => ({
          label: option,
          pressed: hasField(context.filter, field.id, option),
          data: html`data-chip="field" data-field="${field.id}" data-value="${option}"`
        }))
      )
    )}`

const panel = (context: FilterContext): Html => {
  const { filter, workflow } = context
  return html`
    <div class="select-menu glass filter-menu">
      ${chips(
        'Tipo',
        listChips(
          filter,
          'typeIds',
          workflow.types.map((type) => ({ value: type.id, label: type.name }))
        )
      )}
      ${chips(
        'Estado',
        listChips(
          filter,
          'stateIds',
          workflow.states.map((state) => ({ value: state.id, label: state.name }))
        )
      )}
      ${chips('Responsável', listChips(filter, 'assignees', people(context)))}
      ${chips(
        'Prioridade',
        listChips(
          filter,
          'priorities',
          PRIORITIES.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] }))
        )
      )}
      <div class="filter-group">
        <label class="label" for="filter-labels">Labels (qualquer uma)</label>
        <input id="filter-labels" class="input" data-filter-labels value="${(filter.labelsAny ?? []).join(', ')}" placeholder="okr-saude-escala, business-form" />
      </div>
      ${chips('Criado', periodChips('created', filter))}
      ${chips('Atualizado', periodChips('updated', filter))}
      ${chips('Data limite', dueChips(filter))}
      ${movedChips(context)}
      ${fieldChips(context)}
    </div>
  `
}

/** The Filtros button and its panel (escopo-mvp 3.4). Every condition is a chip; any chip combines. */
export const filterPicker = (context: FilterContext): Html => {
  const count = conditionCount(context.filter)
  return html`
    <details class="filter-picker" data-filter-picker ${pickerOpen ? html`open` : ''}>
      <summary class="button button-secondary">${icon('filter', 16)}Filtros${count ? html` <span class="count">${count}</span>` : ''}</summary>
      ${panel(context)}
    </details>
    ${isEmpty(context.filter) ? '' : html`<button type="button" class="button button-ghost" data-clear-filter>Limpar filtros</button>`}
  `
}

/** Draws the screen again with the new filter in the address; the screen reads it from there. */
export const applyFilter = (spaceId: string, filter: CardFilter): void => {
  history.replaceState(null, '', withParams(location.pathname + location.search, { filtro: filterParam(filter) }))
  invalidate(`space:${spaceId}:cards:`)
}

/** What a chip does to the filter, by its `data-chip`. */
const CHIP_ACTIONS: Record<string, (filter: CardFilter, chip: HTMLElement) => CardFilter> = {
  list: (filter, chip) => toggleValue(filter, chip.dataset.key as ListKey, chip.dataset.value ?? ''),
  field: (filter, chip) => toggleField(filter, chip.dataset.field ?? '', chip.dataset.value ?? ''),
  period: (filter, chip) => {
    const key = chip.dataset.key as 'created' | 'updated'
    const same = filter[key]?.from === chip.dataset.value
    return withCondition(filter, key, same ? undefined : { from: chip.dataset.value ?? '' })
  },
  due: (filter, chip) => {
    const same = dueChoice(filter.due) === chip.dataset.value
    return withCondition(filter, 'due', same ? undefined : dueRange(chip.dataset.value ?? ''))
  },
  'moved-state': (filter, chip) => {
    const current = filter.movedTo?.stateIds ?? []
    const value = chip.dataset.value ?? ''
    const stateIds = current.includes(value) ? current.filter((each) => each !== value) : [...current, value]
    const after = filter.movedTo?.after ?? '-7d'
    return withCondition(filter, 'movedTo', stateIds.length ? { stateIds, after } : undefined)
  },
  'moved-after': (filter, chip) =>
    filter.movedTo ? { ...filter, movedTo: { ...filter.movedTo, after: chip.dataset.value ?? '-7d' } } : filter
}

export const bindFilterPicker = (root: HTMLElement, context: FilterContext): void => {
  const picker = root.querySelector<HTMLDetailsElement>('[data-filter-picker]')
  picker?.addEventListener('toggle', () => {
    pickerOpen = picker.open
  })
  picker?.addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-chip]')
    const action = chip ? CHIP_ACTIONS[chip.dataset.chip ?? ''] : undefined
    if (chip && action) {
      applyFilter(context.spaceId, action(context.filter, chip))
    }
  })
  picker?.querySelector<HTMLInputElement>('[data-filter-labels]')?.addEventListener('change', (event) => {
    const labelsAny = parseLabels((event.target as HTMLInputElement).value)
    applyFilter(context.spaceId, { ...context.filter, labelsAny })
  })
  // Clearing leaves the saved view too: with it still named, its own filter would come straight back.
  root.querySelector('[data-clear-filter]')?.addEventListener('click', () => {
    pickerOpen = false
    history.replaceState(
      null,
      '',
      withParams(location.pathname + location.search, { filtro: undefined, visao: undefined })
    )
    invalidate(`space:${context.spaceId}:cards:`)
  })
}

/** A saved view's name, as the views menu lists it. */
export const viewLabel = (view: SavedView): string => (view.scope === 'personal' ? `${view.name} (pessoal)` : view.name)
