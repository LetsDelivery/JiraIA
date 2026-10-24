import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'

import { type Html, html } from '@/lib/html'

import { icon } from './icons'

export type PickerItem = {
  value: string
  label: string
  hint?: string
  /** What goes before the label: an avatar, a priority's icon. */
  lead?: Html
}

export type PickerOptions = {
  anchor: HTMLElement
  /** Names the list for assistive tech, and is the search's placeholder. */
  label: string
  items: readonly PickerItem[]
  chosen: readonly string[]
  /** Several values at once (labels); the choice is applied when the menu closes. */
  multiple?: boolean
  /** Lets a value nobody has yet be typed in, as "Criar …"; answers the value to add. */
  create?: (text: string) => string
  choose: (values: string[]) => void
}

/** One open picker: what it offers — the options and what was created in it — and what is ticked. */
type Open = { options: PickerOptions; items: PickerItem[]; chosen: Set<string>; panel: HTMLElement; close: () => void }

let current: (() => void) | undefined

const place = (anchor: HTMLElement, panel: HTMLElement) => () =>
  void computePosition(anchor, panel, {
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })]
  }).then(({ x, y }) => Object.assign(panel.style, { left: `${x}px`, top: `${y}px` }))

/**
 * A panel floating beside `anchor`, above everything — inside the open dialog when there is one, which
 * would otherwise cover it. Escape, a click outside or another panel closes it; `onClose` runs once.
 */
export const openFloating = (anchor: HTMLElement, panel: HTMLElement, onClose: () => void = () => {}): (() => void) => {
  current?.()
  panel.classList.add('picker', 'glass')
  ;(anchor.closest('dialog') ?? document.body).append(panel)
  const stop = autoUpdate(anchor, panel, place(anchor, panel))
  let release = () => {}
  const close = () => {
    stop()
    release()
    panel.remove()
    current = undefined
    onClose()
  }
  release = _dismissing(panel, close)
  current = close
  return close
}

/**
 * A click outside, or Escape wherever the focus is, closes the panel — and only it: without
 * preventDefault, Escape would close the card's dialog too. Answers how to stop listening.
 */
const _dismissing = (panel: HTMLElement, close: () => void): (() => void) => {
  const outside = (event: MouseEvent) => {
    if (!panel.contains(event.target as Node)) {
      close()
    }
  }
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }
  document.addEventListener('mousedown', outside, true)
  document.addEventListener('keydown', onEscape, true)
  return () => {
    document.removeEventListener('mousedown', outside, true)
    document.removeEventListener('keydown', onEscape, true)
  }
}

const check = (on: boolean): Html => icon(on ? 'circleCheck' : 'circle', 16)

const option = (item: PickerItem, on: boolean, multiple: boolean): Html => html`
  <li role="option" tabindex="-1" data-value="${item.value}" aria-selected="${on}" data-name="${item.label.toLowerCase()}">
    ${multiple ? html`<span class="picker-check">${check(on)}</span>` : ''}
    ${item.lead ?? ''}<span class="picker-label">${item.label}</span>
    ${item.hint ? html`<small>${item.hint}</small>` : ''}
  </li>
`

const markup = (options: PickerOptions, chosen: ReadonlySet<string>): Html => html`
  <input class="input picker-search" placeholder="${options.label}" aria-label="${options.label}" autocomplete="off" data-picker-search />
  <ul class="picker-list" role="listbox" aria-label="${options.label}" ${options.multiple ? html`aria-multiselectable="true"` : ''}>
    ${options.items.map((item) => option(item, chosen.has(item.value), options.multiple ?? false))}
  </ul>
  <p class="muted picker-empty" data-picker-empty hidden>Nada com esse nome.</p>
  ${options.create ? html`<button type="button" class="compose-link picker-create" data-picker-create hidden></button>` : ''}
`

/**
 * A searchable list floating beside its trigger: one value, chosen and applied at once, or several,
 * ticked and applied together when the menu closes. Arrow keys move, Enter picks.
 */
export const openPicker = (options: PickerOptions): void => {
  const chosen = new Set(options.chosen)
  const before = [...chosen].sort().join('\n')
  const panel = document.createElement('div')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', options.label)
  panel.innerHTML = markup(options, chosen).value
  const close = openFloating(options.anchor, panel, () => {
    if (options.multiple && [...chosen].sort().join('\n') !== before) {
      options.choose([...chosen])
    }
    options.anchor.focus({ preventScroll: true })
  })
  _bind({ options, items: [...options.items], chosen, panel, close })
  panel.querySelector<HTMLInputElement>('[data-picker-search]')?.focus()
}

/** One value closes the menu and is applied; with several, it is ticked or unticked. */
const _pick = (open: Open, value: string): void => {
  if (!open.options.multiple) {
    open.close()
    open.options.choose([value])
    return
  }
  open.chosen.has(value) ? open.chosen.delete(value) : open.chosen.add(value)
  const each = open.panel.querySelector<HTMLElement>(`[role="option"][data-value="${CSS.escape(value)}"]`)
  each?.setAttribute('aria-selected', String(open.chosen.has(value)))
  each?.querySelector('.picker-check')?.replaceChildren(_fragment(check(open.chosen.has(value))))
}

/** Markup the app ships, as nodes. */
const _fragment = (markup: Html): DocumentFragment => document.createRange().createContextualFragment(markup.value)

/** Typing narrows the list; a name nobody has yet is offered to create. */
const _filter = (open: Open, query: string): void => {
  const text = query.trim().toLowerCase()
  let shown = 0
  for (const each of open.panel.querySelectorAll<HTMLElement>('[role="option"]')) {
    each.hidden = !(each.dataset.name ?? '').includes(text)
    shown += each.hidden ? 0 : 1
  }
  const create = open.panel.querySelector<HTMLElement>('[data-picker-create]')
  if (create) {
    create.hidden = !text || open.items.some((item) => item.label.toLowerCase() === text)
    create.textContent = `Criar “${query.trim()}”`
  }
  ;(open.panel.querySelector('[data-picker-empty]') as HTMLElement).hidden = shown > 0 || create?.hidden === false
}

/** The typed name becomes an option of its own, already ticked. */
const _create = (open: Open, search: HTMLInputElement): void => {
  const value = open.options.create?.(search.value.trim()) ?? ''
  if (!value) {
    return
  }
  const item = { value, label: value }
  open.items.push(item)
  open.panel.querySelector('.picker-list')?.append(_fragment(option(item, false, open.options.multiple ?? false)))
  search.value = ''
  _filter(open, '')
  _pick(open, value)
  search.focus()
}

const _bind = (open: Open): void => {
  const search = open.panel.querySelector('[data-picker-search]') as HTMLInputElement
  search.addEventListener('input', () => _filter(open, search.value))
  open.panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const chosen = target.closest<HTMLElement>('[role="option"]')
    if (chosen) {
      _pick(open, chosen.dataset.value ?? '')
    } else if (target.closest('[data-picker-create]')) {
      _create(open, search)
    }
  })
  open.panel.addEventListener('keydown', (event) => _onKey(open, search, event))
}

const _onKey = (open: Open, search: HTMLInputElement, event: KeyboardEvent): void => {
  const shown = [...open.panel.querySelectorAll<HTMLElement>('[role="option"]:not([hidden])')]
  const index = shown.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    _move(shown, index + (event.key === 'ArrowDown' ? 1 : -1), search)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    _enter(open, search, shown[index] ?? (shown.length === 1 ? shown[0] : undefined))
  }
}

/** Up from the first option goes back to the search; down stops at the last. */
const _move = (shown: readonly HTMLElement[], next: number, search: HTMLInputElement): void => {
  const target = next < 0 ? search : shown[Math.min(next, shown.length - 1)]
  target?.focus()
}

/** Enter picks the focused option, or the only one left; with none, it creates what was typed. */
const _enter = (open: Open, search: HTMLInputElement, target: HTMLElement | undefined): void => {
  if (target) {
    _pick(open, target.dataset.value ?? '')
  } else if (open.options.create && search.value.trim()) {
    _create(open, search)
  }
}
