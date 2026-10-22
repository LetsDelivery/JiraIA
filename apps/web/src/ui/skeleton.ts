import { type Html, html } from '@/lib/html'

/** The shape a screen has while it loads; a screen that declares none gets `list`. */
export type SkeletonKind = 'list' | 'board' | 'table' | 'document'

/** Widths that vary from row to row, so the placeholder reads as text rather than as a grid. */
const WIDTHS = [72, 56, 84, 48, 64, 76, 52]

const bar = (kind: string, width?: number): Html =>
  width === undefined
    ? html`<span class="sk ${kind}"></span>`
    : html`<span class="sk ${kind}" style="width: ${width}%"></span>`

const times = <T>(count: number, each: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => each(index))

const header = (): Html => html`<div class="sk-header">${bar('sk-title')}${bar('sk-line', 32)}</div>`

const list = (): Html => html`
  ${header()}
  <div class="sk-rows">${times(6, (index) => html`<div class="sk-row">${bar('sk-icon')}${bar('sk-line', WIDTHS[index])}</div>`)}</div>
`

const board = (): Html => html`
  ${header()}
  <div class="sk-board">${times(4, (column) => html`<div class="sk-column">${bar('sk-line', 40)}${times(3 - (column % 2), () => bar('sk-card'))}</div>`)}</div>
`

const table = (): Html => html`
  ${header()}
  ${bar('sk-toolbar')}
  <div class="sk-table">${times(7, (index) => html`<div class="sk-table-row">${bar('sk-line', WIDTHS[index] ?? 60)}${bar('sk-line', 24)}${bar('sk-line', 16)}</div>`)}</div>
`

const document = (): Html => html`
  ${bar('sk-line', 20)}
  <div class="sk-document">
    <div class="sk-document-main">${bar('sk-title')}${bar('sk-surface')}</div>
    <div class="sk-document-panel">${bar('sk-line', 60)}${bar('sk-card')}${bar('sk-card')}</div>
  </div>
`

const SHAPES: Record<SkeletonKind, () => Html> = { list, board, table, document }

/** A screen's place while it loads: its shape in grey, and "Carregando…" for whoever cannot see it. */
export const skeleton = (kind: SkeletonKind = 'list'): Html => html`
  <div class="skeleton skeleton-${kind}" role="status">
    <span class="sr-only">Carregando…</span>
    ${SHAPES[kind]()}
  </div>
`
