import type { Report, ReportOf, Widget, WidgetOf } from '@/api/reports'
import { PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/cards'
import { type Html, html } from '@/lib/html'
import {
  bucketLabel,
  countCaption,
  foldSlices,
  formatCount,
  formatDays,
  GROUPING_LABEL,
  sliceLabel,
  titleOf
} from '@/lib/reports'
import { spacePath } from '@/lib/space-types'

import { bars, columns, donut, line, type Point } from './charts'
import { icon } from './icons'

/**
 * One widget of the Relatórios tab: its frame — with the edit controls while the dashboard is being
 * edited — and its body, drawn from the data the API answered for it (ADR-0016).
 */
const COUNT_ICON = { completed: 'circleCheck', updated: 'pencil', created: 'plus', due_soon: 'calendar' } as const

export const widgetFrame = (widget: Widget, editing: boolean, viewName?: string): Html => html`
  <article class="widget widget-${widget.width} ${widget.kind === 'count' ? 'widget-count' : ''}" data-widget="${widget.id}" ${editing ? html`draggable="true"` : ''}>
    ${editing ? _tools(widget) : ''}
    <header class="widget-head">
      ${widget.kind === 'count' ? html`<span class="widget-icon">${icon(COUNT_ICON[widget.measure], 16)}</span>` : ''}
      <h3>${titleOf(widget)}</h3>
      ${viewName ? html`<span class="chip" title="Conta só os itens desta visão">${icon('filter', 14)}${viewName}</span>` : ''}
    </header>
    <div class="widget-body" data-widget-body aria-busy="true"><div class="widget-loading"></div></div>
  </article>
`

const _tools = (widget: Widget): Html => html`
  <div class="widget-tools">
    <span class="widget-grip" aria-hidden="true">${icon('grip', 16)}</span>
    <button type="button" class="button button-ghost button-icon" data-shift="-1" aria-label="Mover ${titleOf(widget)} para trás">${icon('chevronLeft', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-shift="1" aria-label="Mover ${titleOf(widget)} para frente">${icon('chevronRight', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-edit-widget aria-label="Editar ${titleOf(widget)}">${icon('pencil', 16)}</button>
    <button type="button" class="button button-ghost button-icon" data-remove-widget aria-label="Excluir ${titleOf(widget)}">${icon('trash', 16)}</button>
  </div>
`

const _empty = (text = 'Nenhum item para mostrar.'): Html => html`<p class="widget-empty muted">${text}</p>`

const _count = (widget: WidgetOf<'count'>, report: ReportOf<'count'>): Html => html`
  <p class="widget-number">${formatCount(report.value)}</p>
  <p class="widget-caption muted">${report.value === 1 ? 'item' : 'itens'} ${countCaption(widget)}</p>
`

const _breakdown = (widget: WidgetOf<'breakdown'>, report: ReportOf<'breakdown'>): Html => {
  if (!report.total) {
    return _empty()
  }
  const parts = foldSlices(report.slices.map((slice) => ({ label: sliceLabel(widget.by, slice), count: slice.count })))
  return widget.chart === 'donut' ? donut(parts, report.total) : bars(parts, report.total)
}

const _trend = (widget: WidgetOf<'trend'>, report: ReportOf<'trend'>, width: number): Html => {
  const points: Point[] = report.buckets.map((bucket) => {
    const label = bucketLabel(bucket.start, widget.interval)
    return {
      label,
      value: bucket.count,
      tip: `${label}: ${formatCount(bucket.count)} ${bucket.count === 1 ? 'item' : 'itens'}`
    }
  })
  const total = report.buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  return html`<p class="widget-caption muted">${formatCount(total)} no período</p>${columns(points, width)}`
}

const _timing = (widget: WidgetOf<'timing'>, report: ReportOf<'timing'>, width: number): Html => {
  if (report.averageDays === null) {
    return _empty('Nenhum item concluído no período.')
  }
  const points: Point[] = report.buckets.map((bucket) => {
    const label = bucketLabel(bucket.start, widget.interval)
    const tip = bucket.count
      ? `${label}: média de ${formatDays(bucket.averageDays)} em ${bucket.count} ${bucket.count === 1 ? 'item' : 'itens'}`
      : `${label}: nada concluído`
    return { label, value: bucket.averageDays, tip }
  })
  const unit = (value: number) => `${formatCount(Math.round(value))}d`
  return html`<p class="widget-caption muted">Média de ${formatDays(report.averageDays)}, da ${widget.measure === 'cycle' ? 'primeira entrada em andamento' : 'criação'} à conclusão</p>${line(points, width, unit)}`
}

const _matrix = (widget: WidgetOf<'matrix'>, report: ReportOf<'matrix'>): Html => {
  if (!report.rows.length) {
    return _empty()
  }
  return html`
    <div class="widget-scroll">
      <table class="table table-compact">
        <thead><tr><th>${GROUPING_LABEL[widget.by]}</th>${report.columns.map((column) => html`<th class="numeric">${column.name}</th>`)}<th class="numeric">Total</th></tr></thead>
        <tbody>${report.rows.map(
          (row) =>
            html`<tr><td>${sliceLabel(widget.by, row)}</td>${row.counts.map((count) => html`<td class="numeric ${count ? '' : 'faint'}">${count || '·'}</td>`)}<td class="numeric strong">${row.total}</td></tr>`
        )}</tbody>
      </table>
    </div>
  `
}

const _cards = (report: ReportOf<'cards'>): Html => {
  if (!report.total) {
    return _empty()
  }
  const first = (report.page - 1) * report.pageSize + 1
  const last = first + report.items.length - 1
  return html`
    <div class="widget-scroll">
      <table class="table table-compact">
        <thead><tr><th>Chave</th><th>Tipo</th><th>Prioridade</th><th>Resumo</th><th>Estado</th><th>Responsável</th></tr></thead>
        <tbody>${report.items.map(
          (card) => html`<tr>
            <td><a class="key" href="${spacePath(card.key.split('-')[0] ?? '')}?card=${card.key}">${card.key}</a></td>
            <td>${card.type}</td>
            <td class="nowrap">${icon(PRIORITY_ICON[card.priority], 14)} ${PRIORITY_LABEL[card.priority]}</td>
            <td class="widget-title-cell">${card.title}</td>
            <td><span class="state-chip"><span class="group-dot group-${card.state.group}" aria-hidden="true"></span>${card.state.name}</span></td>
            <td>${card.assignee?.name ?? html`<span class="muted">Sem responsável</span>`}</td>
          </tr>`
        )}</tbody>
      </table>
    </div>
    <footer class="widget-pager">
      <span class="muted">${first}–${last} de ${formatCount(report.total)}</span>
      <button type="button" class="button button-ghost button-icon" data-page="${report.page - 1}" aria-label="Página anterior" ${report.page > 1 ? '' : html`disabled`}>${icon('chevronLeft', 16)}</button>
      <button type="button" class="button button-ghost button-icon" data-page="${report.page + 1}" aria-label="Próxima página" ${last < report.total ? '' : html`disabled`}>${icon('chevronRight', 16)}</button>
    </footer>
  `
}

type Draw = (widget: Widget, report: Report, width: number) => Html

/** One drawing per kind; a widget and its report always share the kind, as the API answers them. */
const BODIES: Record<Widget['kind'], Draw> = {
  count: (widget, report) => _count(widget as WidgetOf<'count'>, report as ReportOf<'count'>),
  breakdown: (widget, report) => _breakdown(widget as WidgetOf<'breakdown'>, report as ReportOf<'breakdown'>),
  trend: (widget, report, width) => _trend(widget as WidgetOf<'trend'>, report as ReportOf<'trend'>, width),
  timing: (widget, report, width) => _timing(widget as WidgetOf<'timing'>, report as ReportOf<'timing'>, width),
  matrix: (widget, report) => _matrix(widget as WidgetOf<'matrix'>, report as ReportOf<'matrix'>),
  cards: (_widget, report) => _cards(report as ReportOf<'cards'>)
}

/** The widget's body from its data; `width` is the pixels the body has, for the charts over time. */
export const widgetBody = (widget: Widget, report: Report, width: number): Html =>
  widget.kind === report.kind ? BODIES[widget.kind](widget, report, width) : _empty()
