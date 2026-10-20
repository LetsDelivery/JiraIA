import { type BulkChanges, type Member, type State, write } from '@/api/requests'
import { parseLabels } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { selectField } from './select'
import { toast } from './toast'

export type BulkContext = {
  spaceId: string
  states: readonly State[]
  members: readonly Member[]
  /** The cards ticked in the list, kept across the re-renders a change causes. */
  selected: Set<string>
}

/** What is ticked in each space's list; a filter or a new sort keeps it. */
const selections = new Map<string, Set<string>>()

export const selectionOf = (spaceId: string): Set<string> => {
  const existing = selections.get(spaceId)
  if (existing) {
    return existing
  }
  const created = new Set<string>()
  selections.set(spaceId, created)
  return created
}

const labelForm = (name: 'add' | 'remove', label: string, placeholder: string): Html => html`
  <form class="inline-form" data-bulk-labels="${name}">
    <label class="sr-only" for="bulk-${name}">${label}</label>
    <input id="bulk-${name}" class="input" name="labels" placeholder="${placeholder}" required />
    <button type="submit" class="button button-ghost">${label}</button>
  </form>
`

/** One change to every ticked card (escopo-mvp 3.8): a state, an assignee, labels on or off. */
export const bulkBar = (context: BulkContext): Html => {
  if (context.selected.size === 0) {
    return html``
  }
  const people = [
    { value: 'none', label: 'Sem responsável' },
    ...context.members
      .filter((member) => member.status === 'active' && member.kind === 'person')
      .map((member) => ({ value: member.id, label: member.name }))
  ]
  return html`
    <div class="toolbar bulk-bar" role="region" aria-label="Ações em massa">
      <strong>${context.selected.size} selecionado${context.selected.size === 1 ? '' : 's'}</strong>
      ${selectField({ name: 'bulk-state', label: 'Mover para', visibleLabel: false, placeholder: 'Mover para…', options: context.states.map((state) => ({ value: state.id, label: state.name })), attributes: html`data-bulk-state` })}
      ${selectField({ name: 'bulk-assignee', label: 'Atribuir a', visibleLabel: false, placeholder: 'Atribuir a…', options: people, attributes: html`data-bulk-assignee` })}
      ${labelForm('add', 'Adicionar labels', 'label-a, label-b')}
      ${labelForm('remove', 'Remover labels', 'label-a')}
      <button type="button" class="button button-ghost" data-bulk-clear>Limpar seleção</button>
    </div>
  `
}

const apply = (context: BulkContext, changes: BulkChanges): void => {
  const count = context.selected.size
  write
    .bulkEdit(context.spaceId, [...context.selected], changes)
    .then(() => toast(`${count} card${count === 1 ? '' : 's'} alterado${count === 1 ? '' : 's'}.`))
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

export const bindBulkBar = (root: HTMLElement, context: BulkContext, redraw: () => void): void => {
  const value = (event: Event) => (event as CustomEvent<{ value: string }>).detail.value
  root.querySelector('[data-bulk-state]')?.addEventListener('select-change', (event) => {
    apply(context, { stateId: value(event) })
  })
  root.querySelector('[data-bulk-assignee]')?.addEventListener('select-change', (event) => {
    apply(context, { assigneeId: value(event) === 'none' ? null : value(event) })
  })
  for (const form of root.querySelectorAll<HTMLFormElement>('[data-bulk-labels]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const labels = parseLabels(String(new FormData(form).get('labels')))
      apply(context, form.dataset.bulkLabels === 'add' ? { addLabels: labels } : { removeLabels: labels })
    })
  }
  root.querySelector('[data-bulk-clear]')?.addEventListener('click', () => {
    context.selected.clear()
    redraw()
  })
}
