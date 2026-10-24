import { type CardType, read, type TypeLook, write } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { busy, submitButton } from './busy'
import { icon } from './icons'
import { openFloating, openPicker } from './picker'
import { toast } from './toast'
import { TYPE_COLORS, TYPE_ICONS, typeIcon } from './type-look'

const row = (type: CardType, index: number, total: number): Html => html`
  <li class="state-row type-row" data-type-id="${type.id}">
    <button type="button" class="button button-ghost button-icon" data-type-look aria-label="Ícone e cor de ${type.name}" title="Ícone e cor">${typeIcon(type, 18)}</button>
    <label class="sr-only" for="type-${type.id}">Nome do tipo</label>
    <input id="type-${type.id}" class="input" data-type-name value="${type.name}" maxlength="60" />
    <button type="button" class="button button-ghost button-icon" data-up aria-label="Subir ${type.name}" ${index === 0 ? html`disabled` : ''}>${icon('arrowUp', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-down aria-label="Descer ${type.name}" ${index === total - 1 ? html`disabled` : ''}>${icon('arrowDown', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-delete aria-label="Excluir ${type.name}" ${total === 1 ? html`disabled` : ''}>${icon('trash', 16)}</button>
  </li>
`

const readOnlyRow = (type: CardType): Html =>
  html`<li class="state-row type-row">${typeIcon(type, 18)}${type.name}</li>`

const editor = (types: readonly CardType[]): Html => html`
  <ol class="states">${types.map((type, index) => row(type, index, types.length))}</ol>
  <form class="state-add" data-add-type>
    <label class="sr-only" for="new-type">Novo tipo</label>
    <input id="new-type" class="input" name="name" placeholder="Novo tipo, ex.: Protótipo" maxlength="60" required />
    <button type="submit" class="button button-secondary">${icon('plus', 16)}Adicionar</button>
  </form>
`

/**
 * The space's card types (escopo-mvp 2.1, ADR-0031), in its settings: admins add, rename, restyle,
 * reorder and remove them; everyone else reads them. A new type takes the look its name suggests.
 */
export const cardTypesPanel = async (spaceId: string, manages: boolean): Promise<Html> => {
  const { types } = await read.workflow(spaceId)
  return html`
    <p class="muted">Os tipos que os cards deste espaço podem ter, na ordem em que aparecem. O ícone e a cor identificam o tipo no board e no card.</p>
    ${manages ? editor(types) : html`<ol class="states">${types.map(readOnlyRow)}</ol>`}
  `
}

type Run = (change: Promise<unknown>) => Promise<unknown>

/** Every change saves and the page draws itself again from the cache. */
export const bindCardTypesPanel = async (root: HTMLElement, spaceId: string): Promise<void> => {
  const form = root.querySelector<HTMLFormElement>('[data-add-type]')
  if (!form) {
    return
  }
  const { types } = await read.workflow(spaceId)
  const run: Run = (change) => change.catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  for (const each of root.querySelectorAll<HTMLElement>('[data-type-id]')) {
    _bindRow(each, spaceId, types, run)
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = String(new FormData(form).get('name')).trim()
    void busy(submitButton(form), () => run(write.addType(spaceId, { name })))
  })
}

const _bindRow = (each: HTMLElement, spaceId: string, types: readonly CardType[], run: Run): void => {
  const index = types.findIndex((type) => type.id === each.dataset.typeId)
  const type = types[index] as CardType
  const swap = (offset: number) => {
    const order = types.map((each) => each.id)
    ;[order[index], order[index + offset]] = [order[index + offset] as string, order[index] as string]
    void run(write.orderTypes(spaceId, order))
  }
  each.querySelector('[data-type-name]')?.addEventListener('change', (event) => {
    void run(write.updateType(spaceId, type.id, { name: (event.target as HTMLInputElement).value.trim() }))
  })
  each.querySelector('[data-up]')?.addEventListener('click', () => swap(-1))
  each.querySelector('[data-down]')?.addEventListener('click', () => swap(1))
  const look = each.querySelector<HTMLElement>('[data-type-look]') as HTMLElement
  look.addEventListener('click', () =>
    _pickLook(look, type, (changes) => void run(write.updateType(spaceId, type.id, changes)))
  )
  const remove = each.querySelector<HTMLElement>('[data-delete]') as HTMLElement
  remove.addEventListener('click', () =>
    _pickDestination(remove, type, types, (moveTo) => void run(write.deleteType(spaceId, type.id, moveTo)))
  )
}

/** The icons and the colours to choose from; one click applies it and closes. */
const _pickLook = (anchor: HTMLElement, type: CardType, save: (changes: TypeLook) => void): void => {
  const panel = document.createElement('div')
  panel.className = 'type-look-picker'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', `Ícone e cor de ${type.name}`)
  panel.innerHTML = html`
    <p class="picker-title">Ícone</p>
    <div class="type-look-grid">${(Object.keys(TYPE_ICONS) as CardType['icon'][]).map(
      (name) =>
        html`<button type="button" class="button button-ghost button-icon type-${type.color}" data-icon="${name}" aria-pressed="${name === type.icon}" aria-label="${TYPE_ICONS[name].label}" title="${TYPE_ICONS[name].label}">${icon(TYPE_ICONS[name].glyph, 18)}</button>`
    )}</div>
    <p class="picker-title">Cor</p>
    <div class="type-look-grid">${(Object.keys(TYPE_COLORS) as CardType['color'][]).map(
      (name) =>
        html`<button type="button" class="type-swatch type-${name}" data-color="${name}" aria-pressed="${name === type.color}" aria-label="${TYPE_COLORS[name]}" title="${TYPE_COLORS[name]}"></button>`
    )}</div>
  `.value
  const close = openFloating(anchor, panel)
  panel.addEventListener('click', (event) => {
    const chosen = (event.target as HTMLElement).closest<HTMLElement>('[data-icon], [data-color]')
    if (chosen) {
      close()
      save(
        chosen.dataset.icon
          ? { icon: chosen.dataset.icon as CardType['icon'] }
          : { color: chosen.dataset.color as CardType['color'] }
      )
    }
  })
  panel.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
}

/** Removing a type asks where everything of it goes: its cards, forms, fields, rules and views. */
const _pickDestination = (
  anchor: HTMLElement,
  type: CardType,
  types: readonly CardType[],
  remove: (moveTo: string) => void
): void =>
  openPicker({
    anchor,
    label: `Excluir “${type.name}”: mover tudo para…`,
    items: types
      .filter((each) => each.id !== type.id)
      .map((each) => ({ value: each.id, label: each.name, lead: typeIcon(each, 16) })),
    chosen: [],
    choose: ([moveTo]) => moveTo && remove(moveTo)
  })
