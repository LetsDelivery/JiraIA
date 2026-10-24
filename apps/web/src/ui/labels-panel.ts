import { type Label, read, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { busy, submitButton } from './busy'
import { icon } from './icons'
import { openFloating } from './picker'
import { toast } from './toast'
import { TYPE_COLORS } from './type-look'

const count = (label: Label): string => (label.cards === 1 ? '1 card' : `${label.cards} cards`)

const dot = (label: Label): Html => html`<span class="tile-dot type-${label.color}" aria-hidden="true"></span>`

const row = (label: Label): Html => html`
  <li class="state-row label-row" data-label-id="${label.id}">
    <button type="button" class="button button-ghost button-icon" data-label-color aria-label="Cor de ${label.name}" title="Cor">${dot(label)}</button>
    <label class="sr-only" for="label-${label.id}">Nome da label</label>
    <input id="label-${label.id}" class="input" data-label-name value="${label.name}" maxlength="60" />
    <span class="muted label-count">${count(label)}</span>
    <button type="button" class="button button-ghost button-icon" data-delete aria-label="Excluir ${label.name}">${icon('trash', 16)}</button>
  </li>
`

const readOnlyRow = (label: Label): Html =>
  html`<li class="state-row label-row">${dot(label)}${label.name}<span class="muted label-count">${count(label)}</span></li>`

const editor = (labels: readonly Label[]): Html => html`
  ${labels.length ? html`<ol class="states">${labels.map(row)}</ol>` : html`<p class="muted">Nenhuma label ainda.</p>`}
  <form class="state-add" data-add-label>
    <label class="sr-only" for="new-label">Nova label</label>
    <input id="new-label" class="input" name="name" placeholder="Nova label, ex.: financeiro" maxlength="60" required />
    <button type="submit" class="button button-secondary">${icon('plus', 16)}Adicionar</button>
  </form>
`

/**
 * The space's labels (ADR-0032), in its settings: each with its colour and how many cards carry it.
 * Admins add, colour, rename — a name another label has joins the two — and remove them from every
 * card; everyone else reads them. A label a card gets anywhere joins the list by itself.
 */
export const labelsPanel = async (spaceId: string, manages: boolean): Promise<Html> => {
  const { items } = await read.labels(spaceId)
  return html`
    <p class="muted">As labels dos cards deste espaço. Renomear muda a label em todos os cards; um nome que já existe junta as duas.</p>
    ${manages ? editor(items) : html`<ol class="states">${items.map(readOnlyRow)}</ol>`}
  `
}

type Run = (change: Promise<unknown>, done?: string) => Promise<unknown>

/** Every change saves and the page draws itself again from the cache. */
export const bindLabelsPanel = async (root: HTMLElement, spaceId: string): Promise<void> => {
  const form = root.querySelector<HTMLFormElement>('[data-add-label]')
  if (!form) {
    return
  }
  const { items } = await read.labels(spaceId)
  const run: Run = (change, done) =>
    change.then(() => done && toast(done)).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  for (const each of root.querySelectorAll<HTMLElement>('[data-label-id]')) {
    const label = items.find((item) => item.id === each.dataset.labelId)
    if (label) {
      _bindRow(each, spaceId, label, items, run)
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = String(new FormData(form).get('name')).trim()
    void busy(submitButton(form), () => run(write.addLabel(spaceId, { name })))
  })
}

const _bindRow = (each: HTMLElement, spaceId: string, label: Label, labels: readonly Label[], run: Run): void => {
  each.querySelector('[data-label-name]')?.addEventListener('change', (event) => {
    const name = (event.target as HTMLInputElement).value.trim()
    const joins = labels.some((other) => other.id !== label.id && other.name === name)
    void run(
      write.updateLabel(spaceId, label.id, { name }),
      joins ? `“${label.name}” juntou-se a “${name}”.` : undefined
    )
  })
  const color = each.querySelector<HTMLElement>('[data-label-color]') as HTMLElement
  color.addEventListener('click', () =>
    _pickColor(color, label, (chosen) => void run(write.updateLabel(spaceId, label.id, { color: chosen })))
  )
  const remove = each.querySelector<HTMLElement>('[data-delete]') as HTMLElement
  remove.addEventListener('click', () =>
    _confirmRemoval(remove, label, () => void run(write.deleteLabel(spaceId, label.id), `“${label.name}” excluída.`))
  )
}

const _pickColor = (anchor: HTMLElement, label: Label, choose: (color: Label['color']) => void): void => {
  const panel = document.createElement('div')
  panel.className = 'type-look-picker'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', `Cor de ${label.name}`)
  panel.innerHTML = html`<div class="type-look-grid">${(Object.keys(TYPE_COLORS) as Label['color'][]).map(
    (name) =>
      html`<button type="button" class="type-swatch type-${name}" data-color="${name}" aria-pressed="${name === label.color}" aria-label="${TYPE_COLORS[name]}" title="${TYPE_COLORS[name]}"></button>`
  )}</div>`.value
  const close = openFloating(anchor, panel)
  panel.addEventListener('click', (event) => {
    const chosen = (event.target as HTMLElement).closest<HTMLElement>('[data-color]')?.dataset.color
    if (chosen) {
      close()
      choose(chosen as Label['color'])
    }
  })
  panel.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

/** Removing a label takes it off every card that has it: the panel says how many before it goes. */
const _confirmRemoval = (anchor: HTMLElement, label: Label, remove: () => void): void => {
  const panel = document.createElement('div')
  panel.className = 'label-removal'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', `Excluir ${label.name}`)
  panel.innerHTML = html`
    <p>Excluir “${label.name}”? ${label.cards ? `Ela sai de ${count(label)}; o histórico de cada um guarda a mudança.` : 'Nenhum card a usa.'}</p>
    <button type="button" class="button button-primary button-small" data-confirm>Excluir</button>
  `.value
  const close = openFloating(anchor, panel)
  panel.querySelector('[data-confirm]')?.addEventListener('click', () => {
    close()
    remove()
  })
  panel.querySelector<HTMLElement>('[data-confirm]')?.focus()
}
