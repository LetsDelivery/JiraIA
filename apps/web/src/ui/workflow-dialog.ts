import { read, type State, type Workflow, write } from '@/api/requests'
import { STATE_GROUP_LABEL, STATE_GROUPS } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { busy, submitButton } from '@/ui/busy'
import { icon } from './icons'
import { bindSelects, selectField } from './select'
import { toast } from './toast'

const GROUP_OPTIONS = STATE_GROUPS.map((group) => ({ value: group, label: STATE_GROUP_LABEL[group] }))

const stateRow = (state: State, index: number, total: number): Html => html`
  <li class="state-row" data-state="${state.id}">
    <span class="group-dot group-${state.group}" aria-hidden="true"></span>
    <label class="sr-only" for="state-${state.id}">Nome do estado</label>
    <input id="state-${state.id}" class="input" data-state-name value="${state.name}" maxlength="60" />
    ${selectField({ name: `group-${state.id}`, label: `Grupo de ${state.name}`, visibleLabel: false, options: GROUP_OPTIONS, value: state.group, attributes: html`data-state-group` })}
    <button type="button" class="button button-ghost button-icon" data-up aria-label="Subir ${state.name}" ${index === 0 ? html`disabled` : ''}>${icon('arrowUp', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-down aria-label="Descer ${state.name}" ${index === total - 1 ? html`disabled` : ''}>${icon('arrowDown', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-delete aria-label="Excluir ${state.name}">${icon('trash', 16)}</button>
  </li>
`

const content = (workflow: Workflow): Html => html`
  <header class="dialog-header">
    <h2>Configurar fluxo</h2>
    <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
  </header>
  <div class="dialog-body">
    <p class="muted">As colunas do board, na ordem. O grupo diz o que o estado significa nos relatórios. O nome aceita emoji.</p>
    <ol class="states">${workflow.states.map((state, index) => stateRow(state, index, workflow.states.length))}</ol>
    <form class="state-add" data-add-state>
      <label class="sr-only" for="new-state">Novo estado</label>
      <input id="new-state" class="input" name="name" placeholder="Novo estado, ex.: 🚧 Bloqueado" maxlength="60" required />
      ${selectField({ name: 'group', label: 'Grupo do novo estado', visibleLabel: false, options: GROUP_OPTIONS, value: 'in_progress' })}
      <button type="submit" class="button button-secondary">${icon('plus', 16)}Adicionar</button>
    </form>
  </div>
`

/**
 * The workflow editor (escopo-mvp 2.2): add, rename, regroup, reorder and delete states. Every change
 * saves at once; deleting a state that holds cards asks where they go.
 */
export const openWorkflowEditor = async (spaceId: string): Promise<void> => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass workflow-dialog'
  dialog.setAttribute('aria-label', 'Configurar fluxo')
  document.body.append(dialog)
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  dialog.addEventListener('cancel', close)
  dialog.showModal()
  await render(dialog, spaceId, close)
}

const render = async (dialog: HTMLDialogElement, spaceId: string, close: () => void): Promise<void> => {
  const workflow = await read.workflow(spaceId)
  dialog.innerHTML = content(workflow).value
  bindSelects(dialog)
  bind(dialog, spaceId, workflow, close)
}

const bind = (dialog: HTMLDialogElement, spaceId: string, workflow: Workflow, close: () => void): void => {
  const again = () => render(dialog, spaceId, close)
  const run = (change: Promise<unknown>) =>
    change.then(again).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  const ids = workflow.states.map((state) => state.id)

  dialog.querySelector('[data-close]')?.addEventListener('click', close)
  for (const row of dialog.querySelectorAll<HTMLElement>('[data-state]')) {
    const stateId = row.dataset.state ?? ''
    const index = ids.indexOf(stateId)
    const swap = (offset: number) => {
      const order = [...ids]
      ;[order[index], order[index + offset]] = [order[index + offset] as string, order[index] as string]
      void run(write.orderStates(spaceId, order))
    }
    row.querySelector('[data-state-name]')?.addEventListener('change', (event) => {
      void run(write.updateState(spaceId, stateId, { name: (event.target as HTMLInputElement).value.trim() }))
    })
    row.addEventListener('select-change', (event) => {
      void run(
        write.updateState(spaceId, stateId, { group: (event as CustomEvent<{ value: State['group'] }>).detail.value })
      )
    })
    row.querySelector('[data-up]')?.addEventListener('click', () => swap(-1))
    row.querySelector('[data-down]')?.addEventListener('click', () => swap(1))
    row.querySelector('[data-delete]')?.addEventListener('click', () => void remove(spaceId, workflow, stateId, run))
  }
  dialog.querySelector<HTMLFormElement>('[data-add-state]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const data = new FormData(form)
    void busy(submitButton(form), () =>
      run(write.addState(spaceId, String(data.get('name')).trim(), String(data.get('group'))))
    )
  })
}

/** A state with cards moves them to the next state (or the previous, for the last one). */
const remove = async (
  spaceId: string,
  workflow: Workflow,
  stateId: string,
  run: (change: Promise<unknown>) => Promise<unknown>
) => {
  const cards = (await read.cards(spaceId)).items.filter((card) => card.stateId === stateId).length
  const index = workflow.states.findIndex((state) => state.id === stateId)
  const target = workflow.states[index + 1] ?? workflow.states[index - 1]
  const name = workflow.states[index]?.name ?? ''
  const question = cards
    ? `Excluir "${name}"? Os ${cards} cards dele vão para "${target?.name}".`
    : `Excluir "${name}"?`

  if (confirm(question)) {
    await run(write.deleteState(spaceId, stateId, cards ? target?.id : undefined))
  }
}
