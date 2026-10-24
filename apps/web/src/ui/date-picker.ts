import {
  isoDate,
  type Month,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  shortDate,
  todayInSaoPaulo,
  WEEKDAYS
} from '@/lib/dates'
import { type Html, html } from '@/lib/html'

import { type IconName, icon } from './icons'
import { openFloating } from './picker'

let counter = 0
/** Whether the one document listener that closes open calendars is installed. */
let closing = false

/**
 * A date field drawn by us: a trigger and a calendar that floats (glass), in place of the browser's
 * `<input type="date">`, which the design skill rules out. The value is `YYYY-MM-DD` in a hidden
 * input; choosing a day or "Limpar" fires `date-change` with `{ value }` (`null` when cleared).
 */
export const dateField = (options: {
  name: string
  label: string
  value?: string | null
  readonly?: boolean
  icon?: IconName
  attributes?: Html
}): Html => {
  counter += 1
  const id = `date-${options.name}-${counter}`
  const value = options.value ?? ''

  return html`
    <div class="field date-field" data-date ${options.attributes ?? ''}>
      <span class="label" id="${id}-label">${options.icon ? icon(options.icon, 16) : ''}${options.label}</span>
      <input type="hidden" name="${options.name}" value="${value}" />
      <button type="button" class="select-trigger" aria-haspopup="dialog" aria-expanded="false"
        aria-labelledby="${id}-label" ${options.readonly ? html`disabled` : ''}>
        <span class="select-value ${value ? '' : 'is-placeholder'}">${value ? shortDate(value) : 'Sem data'}</span>
        ${icon('calendar', 16)}
      </button>
      <div class="calendar select-menu glass" role="dialog" aria-label="Escolher ${options.label}" hidden></div>
    </div>
  `
}

const calendar = (month: Month, chosen: string): Html => {
  const today = todayInSaoPaulo()
  return html`
    <div class="calendar-head">
      <button type="button" class="button button-ghost button-icon" data-shift="-1" aria-label="Mês anterior">${icon('chevronLeft', 16)}</button>
      <strong>${monthLabel(month)}</strong>
      <button type="button" class="button button-ghost button-icon" data-shift="1" aria-label="Próximo mês">${icon('chevronRight', 16)}</button>
    </div>
    <div class="calendar-grid" role="grid">
      ${WEEKDAYS.map((day) => html`<span class="calendar-weekday" aria-hidden="true">${day}</span>`)}
      ${monthGrid(month).map(
        (
          day
        ) => html`<button type="button" class="calendar-day ${monthOf(day).month === month.month ? '' : 'is-outside'} ${day === today ? 'is-today' : ''}"
          data-day="${day}" aria-pressed="${day === chosen}" aria-label="${shortDate(day)}">${Number(day.slice(8))}</button>`
      )}
    </div>
    <div class="calendar-foot">
      <button type="button" class="button button-ghost" data-day="${today}">Hoje</button>
      <button type="button" class="button button-ghost" data-clear>Limpar</button>
    </div>
  `
}

const _open = (root: HTMLElement, open: boolean, month?: Month): void => {
  const panel = root.querySelector('.calendar') as HTMLElement
  const value = (root.querySelector('input[type="hidden"]') as HTMLInputElement).value
  root.querySelector('.select-trigger')?.setAttribute('aria-expanded', String(open))
  panel.hidden = !open
  if (open) {
    const shown = month ?? monthOf(value || todayInSaoPaulo())
    panel.dataset.month = isoDate(shown.year, shown.month, 1)
    panel.innerHTML = calendar(shown, value).value
    panel.querySelector<HTMLElement>('[aria-pressed="true"], .is-today')?.focus()
  }
}

const _choose = (root: HTMLElement, value: string | null): void => {
  ;(root.querySelector('input[type="hidden"]') as HTMLInputElement).value = value ?? ''
  const label = root.querySelector('.select-value') as HTMLElement
  label.textContent = value ? shortDate(value) : 'Sem data'
  label.classList.toggle('is-placeholder', !value)
  _open(root, false)
  ;(root.querySelector('.select-trigger') as HTMLElement).focus()
  root.dispatchEvent(new CustomEvent('date-change', { bubbles: true, detail: { value } }))
}

const _onClick = (root: HTMLElement, event: Event): void => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-day], [data-shift], [data-clear]')
  const panel = root.querySelector('.calendar') as HTMLElement
  if (target?.dataset.day) {
    _choose(root, target.dataset.day)
  } else if (target?.dataset.shift) {
    _open(root, true, shiftMonth(monthOf(panel.dataset.month ?? todayInSaoPaulo()), Number(target.dataset.shift)))
  } else if (target?.hasAttribute('data-clear')) {
    _choose(root, null)
  }
}

/** Wires every date field under `scope` not wired yet; Escape or a click outside closes the calendar. */
export const bindDatePickers = (scope: ParentNode): void => {
  for (const root of scope.querySelectorAll<HTMLElement>('[data-date]:not([data-bound])')) {
    root.dataset.bound = ''
    root.querySelector('.select-trigger')?.addEventListener('click', () => {
      _open(root, root.querySelector('.calendar')?.hasAttribute('hidden') ?? false)
    })
    root.querySelector('.calendar')?.addEventListener('click', (event) => {
      // The calendar redraws itself on a month change; the click must not then read as "outside".
      event.stopPropagation()
      _onClick(root, event)
    })
    root.addEventListener('keydown', (event) => event.key === 'Escape' && _open(root, false))
  }
  if (!closing) {
    closing = true
    document.addEventListener('click', (event) => {
      for (const root of document.querySelectorAll<HTMLElement>('[data-date]')) {
        if (!root.contains(event.target as Node)) {
          _open(root, false)
        }
      }
    })
  }
}

/**
 * The same calendar, floating beside any trigger — a due date on a board tile — with no field around
 * it. `choose` gets the day, or `null` for "Limpar".
 */
export const openCalendar = (
  anchor: HTMLElement,
  value: string | null,
  choose: (value: string | null) => void
): void => {
  const panel = document.createElement('div')
  panel.className = 'calendar'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Escolher data')
  const draw = (month: Month) => {
    panel.dataset.month = isoDate(month.year, month.month, 1)
    panel.innerHTML = calendar(month, value ?? '').value
  }
  draw(monthOf(value || todayInSaoPaulo()))
  const close = openFloating(anchor, panel, () => anchor.focus({ preventScroll: true }))
  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-day], [data-shift], [data-clear]')
    if (target?.dataset.shift) {
      draw(shiftMonth(monthOf(panel.dataset.month ?? todayInSaoPaulo()), Number(target.dataset.shift)))
    } else if (target?.dataset.day || target?.hasAttribute('data-clear')) {
      close()
      choose(target.dataset.day ?? null)
    }
  })
  panel.querySelector<HTMLElement>('[aria-pressed="true"], .is-today')?.focus()
}
