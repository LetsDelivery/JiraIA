import { type CardRef, read } from '@/api/requests'
import { type Html, html } from '@/lib/html'

type Picker = {
  id: string
  label: string
  placeholder: string
}

type PickerBinding = {
  /** Which found cards may be offered — e.g. only cards of this space, never the card itself. */
  accept: (card: CardRef) => boolean
  onPick: (card: CardRef) => void
}

/**
 * A text box that finds cards as one types — by key or title — and lists them under it. What it
 * holds stays plain text, so a typed key or a pasted address works without picking from the list.
 */
export const cardPicker = (picker: Picker): Html => html`
  <div class="card-picker">
    <label class="sr-only" for="${picker.id}">${picker.label}</label>
    <input id="${picker.id}" class="input" name="key" autocomplete="off" placeholder="${picker.placeholder}"
      role="combobox" aria-autocomplete="list" aria-controls="${picker.id}-list" aria-expanded="false" />
    <ul class="select-menu glass card-picker-menu" role="listbox" id="${picker.id}-list" hidden></ul>
  </div>
`

const _found = async (query: string, accept: (card: CardRef) => boolean): Promise<CardRef[]> => {
  if (query.trim().length < 2) {
    return []
  }
  const found = await read.search(query.trim()).catch(() => undefined)
  const all = [...(found?.exact ? [found.exact] : []), ...(found?.items ?? []).map((item) => item.card)]
  const unique = all.filter((card, index) => all.findIndex((each) => each.id === card.id) === index)
  return unique.filter(accept).slice(0, 8)
}

const _show = (input: HTMLInputElement, menu: HTMLElement, cards: readonly CardRef[]): void => {
  menu.innerHTML = html`${cards.map(
    (card) =>
      html`<li role="option" tabindex="-1" data-card-id="${card.id}"><span><span class="card-key">${card.key}</span> ${card.title}</span></li>`
  )}`.value
  menu.hidden = cards.length === 0
  input.setAttribute('aria-expanded', String(cards.length > 0))
}

/** Wires one picker: suggestions while typing, a click or Enter on one picks it. */
/** Wires one picker: suggestions while typing, a click or Enter on one picks it. */
export const bindCardPicker = (root: HTMLElement, binding: PickerBinding): void => {
  const input = root.querySelector('input') as HTMLInputElement
  const menu = root.querySelector('[role="listbox"]') as HTMLElement
  let cards: CardRef[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      cards = await _found(input.value, binding.accept)
      _show(input, menu, cards)
    }, 200)
  })
  const pick = (option: HTMLElement | null) => {
    const card = cards.find((each) => each.id === option?.dataset.cardId)
    if (card) {
      input.value = card.key
      _show(input, menu, [])
      binding.onPick(card)
    }
  }
  menu.addEventListener('mousedown', (event) => {
    event.preventDefault()
    pick((event.target as HTMLElement).closest<HTMLElement>('[data-card-id]'))
  })
  _bindKeys(input, menu, pick)
}

const _bindKeys = (input: HTMLInputElement, menu: HTMLElement, pick: (option: HTMLElement | null) => void) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !menu.hidden) {
      event.preventDefault()
      menu.querySelector<HTMLElement>('[role="option"]')?.focus()
    }
  })
  menu.addEventListener('keydown', (event) => _onMenuKey(event, input, menu, pick))
  input.addEventListener('blur', () => setTimeout(() => menu.contains(document.activeElement) || _hide(input, menu), 0))
}

const STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 }

/** Enter picks the focused card; the arrows walk the list, and up from the first goes back to the box. */
const _onMenuKey = (
  event: KeyboardEvent,
  input: HTMLInputElement,
  menu: HTMLElement,
  pick: (option: HTMLElement | null) => void
) => {
  const options = [...menu.querySelectorAll<HTMLElement>('[role="option"]')]
  const index = options.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Enter') {
    event.preventDefault()
    pick(options[index] ?? null)
    return
  }
  const step = STEP[event.key]
  if (step !== undefined) {
    event.preventDefault()
    const next = index + step
    ;(next < 0 ? input : options[Math.min(next, options.length - 1)])?.focus()
  }
}

const _hide = (input: HTMLInputElement, menu: HTMLElement): void => {
  menu.hidden = true
  input.setAttribute('aria-expanded', 'false')
}
