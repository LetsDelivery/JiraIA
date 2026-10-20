/**
 * Markup as tagged templates, escaped by default.
 *
 * Every interpolated value is text unless it is itself `Html` (another template, or `raw`). Names,
 * descriptions and emails come from people, so a `<script>` typed into a space name must arrive on
 * screen as those characters and never as an element. `raw` exists for trusted markup only — the
 * icons this app ships — and is the one thing a review of a view has to look for.
 */
const SAFE = Symbol('html')

export type Html = { readonly [SAFE]: true; readonly value: string }

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeText = (text: string): string => text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? '')

const isHtml = (value: unknown): value is Html => typeof value === 'object' && value !== null && SAFE in value

/** Trusted markup, inserted as is. */
export const raw = (value: string): Html => ({ [SAFE]: true, value })

const _part = (value: unknown): string => {
  if (value === undefined || value === null || value === false) {
    return ''
  }
  if (Array.isArray(value)) {
    return value.map(_part).join('')
  }
  return isHtml(value) ? value.value : escapeText(String(value))
}

/**
 * @example html`<h1>${space.name}</h1>`   // name escaped
 * @example html`<ul>${items.map((item) => html`<li>${item}</li>`)}</ul>`
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): Html =>
  raw(strings.reduce((out, string, index) => out + string + (index < values.length ? _part(values[index]) : ''), ''))
