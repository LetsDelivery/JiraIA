import { computePosition, flip, offset, shift } from '@floating-ui/dom'

import { type Html, html } from '@/lib/html'

import { type IconName, icon } from './icons'

export type SelectOption = { value: string; label: string; hint?: string }

let counter = 0

/**
 * A select drawn by us: a trigger button and a listbox (the design skill rules out native `<select>`
 * for styled UI). The chosen value lives in a hidden input, so it travels with the form like any other.
 *
 * `label` names it; `visibleLabel: false` keeps that name for assistive tech only (a role per table row).
 * `icon` draws in front of a visible label, as the card's side column lists its fields.
 */
export const selectField = (options: {
  name: string
  label: string
  options: readonly SelectOption[]
  value?: string
  placeholder?: string
  visibleLabel?: boolean
  icon?: IconName
  attributes?: Html
}): Html => {
  counter += 1
  const id = `select-${options.name}-${counter}`
  const chosen = options.options.find((option) => option.value === options.value)
  const showLabel = options.visibleLabel !== false

  return html`
    <div class="field select" data-select ${options.attributes ?? ''}>
      ${showLabel ? html`<span class="label" id="${id}-label">${options.icon ? icon(options.icon, 16) : ''}${options.label}</span>` : ''}
      <input type="hidden" name="${options.name}" value="${chosen?.value ?? ''}" />
      <button
        type="button"
        class="select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls="${id}-list"
        ${showLabel ? html`aria-labelledby="${id}-label"` : html`aria-label="${options.label}"`}
      >
        <span class="select-value ${chosen ? '' : 'is-placeholder'}">${chosen?.label ?? options.placeholder ?? 'Escolha…'}</span>
        ${icon('chevronDown', 16)}
      </button>
      <ul class="select-menu glass" role="listbox" id="${id}-list" hidden>
        ${options.options.map(
          (option) => html`
            <li role="option" tabindex="-1" data-value="${option.value}" aria-selected="${option.value === chosen?.value}">
              <span>${option.label}</span>
              ${option.hint ? html`<small>${option.hint}</small>` : ''}
            </li>
          `
        )}
      </ul>
    </div>
  `
}

/**
 * A table clips what overflows it (rounded corners, sideways scroll on small screens), so a menu
 * opened in a row floats fixed beside its trigger instead — below it, or above when there is no room.
 */
const _float = (trigger: HTMLElement, menu: HTMLElement): void => {
  menu.classList.add('is-floating')
  menu.style.minWidth = `${trigger.offsetWidth}px`
  void computePosition(trigger, menu, {
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })]
  }).then(({ x, y }) => Object.assign(menu.style, { left: `${x}px`, top: `${y}px` }))
}

const _open = (root: HTMLElement, open: boolean): void => {
  const trigger = root.querySelector('.select-trigger') as HTMLButtonElement
  const menu = root.querySelector('[role="listbox"]') as HTMLElement
  trigger.setAttribute('aria-expanded', String(open))
  menu.hidden = !open
  if (open && root.closest('.table, .table-scroll')) {
    _float(trigger, menu)
  }
  if (open) {
    const current =
      menu.querySelector<HTMLElement>('[aria-selected="true"]') ?? menu.querySelector<HTMLElement>('[role="option"]')
    current?.focus({ preventScroll: true })
  }
}

const _choose = (root: HTMLElement, option: HTMLElement): void => {
  const input = root.querySelector('input[type="hidden"]') as HTMLInputElement
  const value = option.dataset.value ?? ''
  input.value = value
  root.querySelector('.select-value')?.replaceChildren(option.querySelector('span')?.textContent ?? value)
  root.querySelector('.select-value')?.classList.remove('is-placeholder')
  for (const each of root.querySelectorAll('[role="option"]')) {
    each.setAttribute('aria-selected', String(each === option))
  }
  _open(root, false)
  ;(root.querySelector('.select-trigger') as HTMLElement).focus()
  root.dispatchEvent(new CustomEvent('select-change', { bubbles: true, detail: { value } }))
}

/** Arrow keys move, Enter or Space choose, Escape closes — what a listbox is expected to do. */
const _onKey = (root: HTMLElement, event: KeyboardEvent): void => {
  const options = [...root.querySelectorAll<HTMLElement>('[role="option"]')]
  const index = options.indexOf(document.activeElement as HTMLElement)
  const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 }

  if (event.key === 'Escape') {
    _open(root, false)
  } else if (event.key in moves && index >= 0) {
    event.preventDefault()
    options[Math.min(options.length - 1, Math.max(0, index + (moves[event.key] ?? 0)))]?.focus()
  } else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
    event.preventDefault()
    _choose(root, options[index] as HTMLElement)
  }
}

/** Wires every select under `scope` that is not wired yet. Safe to call after each render. */
export const bindSelects = (scope: ParentNode): void => {
  for (const root of scope.querySelectorAll<HTMLElement>('[data-select]:not([data-bound])')) {
    root.dataset.bound = ''
    root.querySelector('.select-trigger')?.addEventListener('click', () => {
      _open(root, root.querySelector('[role="listbox"]')?.hasAttribute('hidden') ?? false)
    })
    root.querySelector('[role="listbox"]')?.addEventListener('click', (event) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]')
      if (option) {
        _choose(root, option)
      }
    })
    root.addEventListener('keydown', (event) => _onKey(root, event))
  }
}

/** A floating menu stays where it opened, so scrolling or resizing closes it rather than leave it behind. */
const _closeFloating = (event: Event): void => {
  for (const menu of document.querySelectorAll<HTMLElement>('.select-menu.is-floating:not([hidden])')) {
    const root = menu.closest<HTMLElement>('[data-select]')
    if (root && !menu.contains(event.target as Node)) {
      _open(root, false)
    }
  }
}

/** A click anywhere else closes whatever select is open. Installed once by the app. */
export const closeSelectsOnOutsideClick = (): void => {
  document.addEventListener('click', (event) => {
    for (const root of document.querySelectorAll<HTMLElement>('[data-select]')) {
      if (!root.contains(event.target as Node)) {
        _open(root, false)
      }
    }
  })
  document.addEventListener('scroll', _closeFloating, { capture: true, passive: true })
  window.addEventListener('resize', _closeFloating)
}
