import type { Card, Field, Member } from '@/api/requests'
import { shortDate } from '@/lib/dates'
import { type Html, html } from '@/lib/html'

import { dateField } from './date-picker'
import { selectField } from './select'

export const FIELD_KIND_LABEL: Record<Field['kind'], string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção única',
  multi_select: 'Seleção múltipla',
  person: 'Pessoa',
  url: 'URL'
}

/** The fields that show on this card: those of its type, or of every type. */
export const fieldsFor = (card: Pick<Card, 'typeId'>, fields: readonly Field[]): Field[] =>
  fields.filter((field) => field.typeIds.length === 0 || field.typeIds.includes(card.typeId))

const _text = (field: Field, value: unknown, canWrite: boolean): Html => html`
  <div class="field">
    <label for="custom-${field.id}">${field.name}</label>
    <input id="custom-${field.id}" class="input" data-custom="${field.id}" data-kind="${field.kind}"
      value="${value === undefined ? '' : String(value)}" ${field.kind === 'number' ? html`inputmode="decimal"` : ''}
      ${field.kind === 'url' ? html`type="url" placeholder="https://"` : ''} ${canWrite ? '' : html`readonly`} />
    ${field.kind === 'url' && value ? html`<a class="link field-hint" href="${String(value)}" target="_blank" rel="noopener noreferrer">Abrir link</a>` : ''}
  </div>
`

const _multi = (field: Field, value: unknown, canWrite: boolean): Html => {
  const chosen = Array.isArray(value) ? value.map(String) : []
  return html`
    <div class="field">
      <span class="label">${field.name}</span>
      <div class="chips" role="group" aria-label="${field.name}">
        ${field.options.map(
          (
            option
          ) => html`<button type="button" class="chip chip-toggle" data-multi="${field.id}" data-option="${option}"
            aria-pressed="${chosen.includes(option)}" ${canWrite ? '' : html`disabled`}>${option}</button>`
        )}
      </div>
    </div>
  `
}

const _choice = (field: Field, value: unknown, members: readonly Member[], canWrite: boolean): Html => {
  const options =
    field.kind === 'person'
      ? members
          .filter((member) => member.status === 'active' && member.kind === 'person')
          .map((member) => ({ value: member.id, label: member.name }))
      : field.options.map((option) => ({ value: option, label: option }))
  const all = [{ value: '', label: '—' }, ...options]
  if (!canWrite) {
    return html`<div class="field"><span class="label">${field.name}</span><span>${all.find((option) => option.value === value)?.label ?? '—'}</span></div>`
  }
  return selectField({
    name: `custom-${field.id}`,
    label: field.name,
    options: all,
    value: String(value ?? ''),
    attributes: html`data-custom-choice="${field.id}"`
  })
}

const _date = (field: Field, value: unknown, canWrite: boolean): Html =>
  canWrite
    ? dateField({
        name: `custom-${field.id}`,
        label: field.name,
        value: (value as string | undefined) ?? null,
        attributes: html`data-custom-date="${field.id}"`
      })
    : html`<div class="field"><span class="label">${field.name}</span><span>${shortDate(value as string)}</span></div>`

const _input = (field: Field, value: unknown, members: readonly Member[], canWrite: boolean): Html => {
  const byKind: Partial<Record<Field['kind'], () => Html>> = {
    date: () => _date(field, value, canWrite),
    multi_select: () => _multi(field, value, canWrite),
    select: () => _choice(field, value, members, canWrite),
    person: () => _choice(field, value, members, canWrite)
  }
  return byKind[field.kind]?.() ?? _text(field, value, canWrite)
}

/** One input per custom field of the card's type, drawn for its kind (escopo-mvp 2.5). */
export const customFieldInputs = (
  card: Card,
  fields: readonly Field[],
  members: readonly Member[],
  canWrite: boolean
): Html =>
  html`${fieldsFor(card, fields).map((field) => _input(field, card.customFields[field.id], members, canWrite))}`

const _typed = (kind: string, text: string): unknown => {
  if (!text.trim()) {
    return null
  }
  return kind === 'number' ? Number(text.replace(',', '.')) : text.trim()
}

/** Each change saves only that field; `null` clears it. */
export const bindCustomFields = (root: HTMLElement, save: (values: Record<string, unknown>) => void): void => {
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-custom]')) {
    input.addEventListener('change', () =>
      save({ [input.dataset.custom ?? '']: _typed(input.dataset.kind ?? '', input.value) })
    )
  }
  root.addEventListener('select-change', (event) => {
    const id = (event.target as HTMLElement).dataset.customChoice
    if (id) {
      event.stopPropagation()
      save({ [id]: (event as CustomEvent<{ value: string }>).detail.value || null })
    }
  })
  root.addEventListener('date-change', (event) => {
    const id = (event.target as HTMLElement).dataset.customDate
    if (id) {
      save({ [id]: (event as CustomEvent<{ value: string | null }>).detail.value })
    }
  })
  for (const chip of root.querySelectorAll<HTMLButtonElement>('[data-multi]')) {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))
      const group = [...root.querySelectorAll<HTMLElement>(`[data-multi="${chip.dataset.multi}"][aria-pressed="true"]`)]
      const chosen = group.map((each) => each.dataset.option ?? '')
      save({ [chip.dataset.multi ?? '']: chosen.length ? chosen : null })
    })
  }
}
