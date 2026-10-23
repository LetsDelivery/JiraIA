import type { ReportOf, Widget, WidgetKind } from '@/api/reports'

import { PRIORITY_LABEL, type Priority, STATE_GROUP_LABEL, type StateGroup } from './cards'

/**
 * The words and numbers of the Relatórios tab (Etapa 5d, ADR-0016): what each widget is called, how a
 * slice or a bucket is named, and the scales the charts draw against. Pure, so it is tested alone.
 */
export type Grouping = Extract<Widget, { kind: 'breakdown' }>['by']
export type Interval = Extract<Widget, { kind: 'trend' }>['interval']
export type Width = Widget['width']
export type Slice = ReportOf<'breakdown'>['slices'][number]

export const WIDTHS: readonly Width[] = ['quarter', 'third', 'half', 'full']
export const WIDTH_LABEL: Record<Width, string> = {
  quarter: '1/4 da linha',
  third: '1/3 da linha',
  half: 'Meia linha',
  full: 'Linha inteira'
}

export const GROUPING_LABEL: Record<Grouping, string> = {
  state: 'Estado',
  state_group: 'Grupo de estado',
  type: 'Tipo',
  assignee: 'Responsável',
  reporter: 'Relator',
  priority: 'Prioridade',
  squad: 'Squad',
  label: 'Label'
}

const NONE_LABEL: Partial<Record<Grouping, string>> = {
  assignee: 'Sem responsável',
  squad: 'Sem squad',
  label: 'Sem label'
}

export const INTERVAL_LABEL: Record<Interval, string> = { day: 'Dia', week: 'Semana', month: 'Mês' }

const COUNT_TITLE: Record<Extract<Widget, { kind: 'count' }>['measure'], string> = {
  completed: 'Concluídos',
  updated: 'Atualizados',
  created: 'Criados',
  due_soon: 'Vencem em breve'
}

/** What the number counts, under it: "nos últimos 7 dias", or "nos próximos 7 dias" for due dates. */
export const countCaption = (widget: Extract<Widget, { kind: 'count' }>): string => {
  const days = widget.days === 1 ? '1 dia' : `${widget.days} dias`
  return widget.measure === 'due_soon' ? `vencem nos próximos ${days}` : `nos últimos ${days}`
}

const TITLES: { [K in WidgetKind]: (widget: Extract<Widget, { kind: K }>) => string } = {
  count: (widget) => COUNT_TITLE[widget.measure],
  breakdown: (widget) => `Itens por ${GROUPING_LABEL[widget.by].toLowerCase()}`,
  trend: (widget) => (widget.measure === 'created' ? 'Itens criados' : 'Itens concluídos'),
  timing: (widget) => (widget.measure === 'cycle' ? 'Tempo de ciclo' : 'Lead time'),
  matrix: (widget) => `Estado por ${GROUPING_LABEL[widget.by].toLowerCase()}`,
  cards: () => 'Lista de itens',
  burndown: () => 'Burndown da sprint',
  velocity: () => 'Velocidade'
}

/** The name a widget gets from what it shows. */
export const suggestedTitle = (widget: Widget): string => (TITLES[widget.kind] as (each: Widget) => string)(widget)

/** The widget's own title, or the suggested one. */
export const titleOf = (widget: Widget): string => widget.title ?? suggestedTitle(widget)

/** A slice's name: a state or a person as the API names them; a priority or a group in pt-BR. */
export const sliceLabel = (by: Grouping, slice: Pick<Slice, 'key' | 'label'>): string => {
  if (slice.key === null) {
    return NONE_LABEL[by] ?? 'Nenhum'
  }
  if (by === 'priority') {
    return PRIORITY_LABEL[slice.key as Priority] ?? slice.key
  }
  if (by === 'state_group') {
    return STATE_GROUP_LABEL[slice.key as StateGroup] ?? slice.key
  }
  return slice.label ?? slice.key
}

export const OTHERS = 'Outros'

/**
 * The largest slices, the rest folded into "Outros" — a ninth hue is never invented (dataviz skill).
 *
 * @example foldSlices([a5, b3, c1, d1], 2)   // [a5, b3, { label: 'Outros', count: 2 }]
 */
export const foldSlices = <T extends { label: string; count: number }>(slices: readonly T[], keep = 7) => {
  if (slices.length <= keep + 1) {
    return slices.map((slice) => ({ label: slice.label, count: slice.count }))
  }
  const rest = slices.slice(keep).reduce((sum, slice) => sum + slice.count, 0)
  return [
    ...slices.slice(0, keep).map((slice) => ({ label: slice.label, count: slice.count })),
    { label: OTHERS, count: rest }
  ]
}

/**
 * The axis maximum and its ticks: a round step (1, 2 or 5 × 10ⁿ) so four or five gridlines fit.
 *
 * @example niceScale(23)   // { max: 25, ticks: [0, 5, 10, 15, 20, 25] }
 */
export const niceScale = (value: number, lines = 5): { max: number; ticks: number[] } => {
  const raw = Math.max(value, 1) / lines
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  // Counts and days are read in whole steps: an axis of 0,2 items says nothing.
  const step = Math.max(1, ([1, 2, 5, 10].find((each) => each * magnitude >= raw) ?? 10) * magnitude)
  const max = Math.ceil(Math.max(value, 1) / step) * step
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) }
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * A bucket's name on the axis. Buckets are UTC days, so only UTC is read (AGENTS.md).
 *
 * @example bucketLabel('2026-10-05', 'week')   // '05/10'
 * @example bucketLabel('2026-10-01', 'month')  // 'out/26'
 */
export const bucketLabel = (start: string, interval: Interval): string => {
  const [year = '', month = '01', day = '01'] = start.split('-')
  if (interval === 'month') {
    return `${MONTHS[Number(month) - 1]}/${year.slice(2)}`
  }
  return `${day}/${month}`
}

const DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** @example formatDays(3.46)   // '3,5 dias' */
export const formatDays = (days: number | null): string => {
  if (days === null) {
    return '—'
  }
  return `${DECIMAL.format(days)} ${Math.round(days * 10) === 10 ? 'dia' : 'dias'}`
}

export const formatCount = (count: number): string => new Intl.NumberFormat('pt-BR').format(count)

/** The widget `id` moved to just before `before` (or to the end), the rest in order. */
export const moveWidget = (widgets: readonly Widget[], id: string, before: string | null): Widget[] => {
  const moving = widgets.find((each) => each.id === id)
  if (!moving || id === before) {
    return [...widgets]
  }
  const rest = widgets.filter((each) => each.id !== id)
  const at = before === null ? rest.length : rest.findIndex((each) => each.id === before)
  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}

/** One step left or right in the dashboard's order, for the keyboard and the arrow buttons. */
export const shiftWidget = (widgets: readonly Widget[], id: string, by: -1 | 1): Widget[] => {
  const index = widgets.findIndex((each) => each.id === id)
  const target = index + by
  if (index < 0 || target < 0 || target >= widgets.length) {
    return [...widgets]
  }
  const next = [...widgets]
  ;[next[index], next[target]] = [next[target] as Widget, next[index] as Widget]
  return next
}

/** "3 pontos", "1 card": a sprint report's numbers in its unit. */
export const unitText = (value: number, unit: 'points' | 'cards'): string => {
  const shown = formatCount(Math.round(value * 10) / 10)
  if (unit === 'points') {
    return `${shown} ${value === 1 ? 'ponto' : 'pontos'}`
  }
  return `${shown} ${value === 1 ? 'card' : 'cards'}`
}

/**
 * The burndown's ideal: a straight run from the first day's scope to nothing on the sprint's last day,
 * then nothing — a late sprint runs past it.
 *
 * @example idealLine(['10-20', '10-21', '10-22'], 8, '10-22')   // [8, 4, 0]
 */
export const idealLine = (days: readonly string[], scope: number, endsOn: string): number[] => {
  const last = Math.max(days.indexOf(endsOn), 1)
  return days.map((_, index) => Math.max(scope * (1 - index / last), 0))
}
