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

const readOnlyRow = (state: State): Html => html`
  <li class="state-row"><span class="group-dot group-${state.group}" aria-hidden="true"></span>${state.name}<span class="muted">${STATE_GROUP_LABEL[state.group]}</span></li>
`

const editor = (workflow: Workflow): Html => html`
  <ol class="states">${workflow.states.map((state, index) => stateRow(state, index, workflow.states.length))}</ol>
  <form class="state-add" data-add-state>
    <label class="sr-only" for="new-state">Novo estado</label>
    <input id="new-state" class="input" name="name" placeholder="Novo estado, ex.: 🚧 Bloqueado" maxlength="60" required />
    ${selectField({ name: 'group', label: 'Grupo do novo estado', visibleLabel: false, options: GROUP_OPTIONS, value: 'in_progress' })}
    <button type="submit" class="button button-secondary">${icon('plus', 16)}Adicionar</button>
  </form>
`

/**
 * The workflow (escopo-mvp 2.2), in the space's settings: its admins add, rename, regroup, reorder and
 * delete states, each change saved at once; everyone else reads the columns and what each one means.
 */
export const workflowPanel = async (spaceId: string, manages: boolean): Promise<Html> => {
  const [workflow, space] = await Promise.all([read.workflow(spaceId), read.space(spaceId)])
  return html`
    <p class="muted">As colunas do board, na ordem. O grupo diz o que o estado significa nos relatórios. O nome aceita emoji.</p>
    ${manages ? editor(workflow) : html`<ol class="states">${workflow.states.map(readOnlyRow)}</ol>`}
    ${mergedSection(workflow, space.mergedStateId, manages)}
  `
}

/**
 * Where a card goes when a pull request that names it is merged into the repository's main branch
 * (ADR-0038). "Não mover" leaves it where it is; a card already done or cancelled never moves.
 */
const mergedSection = (workflow: Workflow, mergedStateId: string | null, manages: boolean): Html => {
  const chosen = workflow.states.find((state) => state.id === mergedStateId)
  const options = [
    { value: '', label: 'Não mover' },
    ...workflow.states.map((state) => ({ value: state.id, label: state.name }))
  ]
  return html`
    <section class="merged-state" data-merged-state>
      <h3>${icon('gitMerge', 16)}Quando um pull request é mergeado</h3>
      <p class="muted">Pull request com a chave do card que entra na branch principal do repositório no GitHub move o card para este estado. Card concluído ou cancelado fica onde está.</p>
      ${
        manages
          ? selectField({ name: 'mergedStateId', label: 'Mover o card para', options, value: chosen?.id ?? '' })
          : html`<p>${chosen ? html`Move o card para <strong>${chosen.name}</strong>.` : 'Não move o card.'}</p>`
      }
    </section>
  `
}

/** Every change saves and the page draws itself again from the cache. */
export const bindWorkflowPanel = async (root: HTMLElement, spaceId: string): Promise<void> => {
  if (!root.querySelector('[data-add-state]')) {
    return
  }
  const workflow = await read.workflow(spaceId)
  bindSelects(root)
  root.querySelector('[data-merged-state]')?.addEventListener('select-change', (event) => {
    const value = (event as CustomEvent<{ value: string }>).detail.value
    void write
      .setMergedState(spaceId, value || null)
      .then(() =>
        toast(value ? 'Pull request mergeado agora move o card.' : 'Pull request mergeado não move mais o card.')
      )
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  })
  const run = (change: Promise<unknown>) => change.catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  const ids = workflow.states.map((state) => state.id)
  for (const row of root.querySelectorAll<HTMLElement>('[data-state]')) {
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
  root.querySelector<HTMLFormElement>('[data-add-state]')?.addEventListener('submit', (event) => {
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
