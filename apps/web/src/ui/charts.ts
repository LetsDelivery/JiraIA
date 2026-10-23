import { type Html, html } from '@/lib/html'
import { formatCount, niceScale, OTHERS } from '@/lib/reports'

/**
 * The charts of the Relatórios tab, drawn as SVG by hand (ADR-0006, ADR-0016) to the dataviz skill's
 * specs: thin marks, a 2px surface gap between fills, hairline grid, series hues in a fixed order, and
 * a tooltip on every mark. Each chart takes the pixel width it is drawn at, so text never scales.
 */
export type Part = { label: string; count: number }
export type Point = { label: string; value: number | null; tip: string }

const HEIGHT = 180
const PAD = { top: 8, right: 8, bottom: 22, left: 34 }
const BAR_MAX = 24

/** A slice's hue: its place in the order, never its rank after a filter; "Outros" is grey. */
export const seriesColor = (label: string, index: number): string =>
  label === OTHERS ? 'var(--series-other)' : `var(--series-${(index % 8) + 1})`

const percent = (count: number, total: number): string => `${Math.round((count / Math.max(total, 1)) * 100)}%`

const _arc = (start: number, end: number, outer: number, inner: number): string => {
  const point = (angle: number, radius: number) =>
    `${(radius * Math.sin(angle)).toFixed(2)} ${(-radius * Math.cos(angle)).toFixed(2)}`
  const large = end - start > Math.PI ? 1 : 0
  return `M ${point(start, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(end, outer)} L ${point(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(start, inner)} Z`
}

const _segments = (parts: readonly Part[], total: number, outer: number, inner: number): Html[] => {
  let start = 0
  return parts.map((part, index) => {
    // A full ring cannot be one arc: stop just short of the start so the path still closes.
    const end = Math.min(start + (part.count / total) * Math.PI * 2, start + Math.PI * 2 - 0.0001)
    const path = _arc(start, end, outer, inner)
    start = end
    const tip = `${part.label}: ${formatCount(part.count)} (${percent(part.count, total)})`
    return html`<path d="${path}" fill="${seriesColor(part.label, index)}" class="chart-segment" data-tip="${tip}"></path>`
  })
}

/** The legend beside a donut or under bars: every slice named, with its count — color is never alone. */
export const legend = (parts: readonly Part[], total: number): Html => html`
  <ul class="chart-legend">
    ${parts.map(
      (part, index) => html`<li>
        <span class="chart-swatch" style="background:${seriesColor(part.label, index)}"></span>
        <span class="chart-legend-label">${part.label}</span>
        <span class="chart-legend-value">${formatCount(part.count)} · ${percent(part.count, total)}</span>
      </li>`
    )}
  </ul>
`

/** Parts of a whole, with the total in the middle. */
export const donut = (parts: readonly Part[], total: number): Html => {
  const size = 148
  const outer = size / 2
  return html`
    <div class="chart-donut">
      <svg viewBox="${-outer} ${-outer} ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${parts.map((part) => `${part.label} ${part.count}`).join(', ')}">
        ${total ? _segments(parts, total, outer, outer - 18) : html`<circle r="${outer - 9}" fill="none" stroke="var(--chart-grid)" stroke-width="18"></circle>`}
        <text class="chart-donut-total" y="2" text-anchor="middle">${formatCount(total)}</text>
        <text class="chart-donut-caption" y="20" text-anchor="middle">itens</text>
      </svg>
      ${legend(parts, total)}
    </div>
  `
}

/** Horizontal bars, one hue: a single measure split by category, labels where they can be read. */
export const bars = (parts: readonly Part[], total: number): Html => {
  const max = Math.max(...parts.map((part) => part.count), 1)
  return html`
    <ul class="chart-bars">
      ${parts.map(
        (part) => html`<li data-tip="${part.label}: ${formatCount(part.count)} (${percent(part.count, total)})">
          <span class="chart-bar-label">${part.label}</span>
          <span class="chart-bar-track"><span class="chart-bar" style="width:${((part.count / max) * 100).toFixed(1)}%"></span></span>
          <span class="chart-bar-value">${formatCount(part.count)}</span>
        </li>`
      )}
    </ul>
  `
}

type Frame = { width: number; plot: number; band: number; scale: { max: number; ticks: number[] } }

const _frame = (width: number, points: readonly Point[]): Frame => {
  const plot = Math.max(width - PAD.left - PAD.right, 40)
  const top = Math.max(...points.map((point) => point.value ?? 0), 0)
  return { width, plot, band: plot / Math.max(points.length, 1), scale: niceScale(top, 4) }
}

const _y = (frame: Frame, value: number): number =>
  PAD.top + (HEIGHT - PAD.top - PAD.bottom) * (1 - value / frame.scale.max)

/** Gridlines with their values, and as many bucket names as fit without touching. */
const _axes = (frame: Frame, points: readonly Point[], format: (value: number) => string): Html => {
  const every = Math.max(1, Math.ceil((points.length * 46) / frame.plot))
  const grid = frame.scale.ticks.map(
    (
      tick
    ) => html`<line x1="${PAD.left}" x2="${frame.width - PAD.right}" y1="${_y(frame, tick)}" y2="${_y(frame, tick)}" class="${tick ? 'chart-grid' : 'chart-baseline'}"></line>
      <text x="${PAD.left - 6}" y="${_y(frame, tick) + 4}" text-anchor="end" class="chart-tick">${format(tick)}</text>`
  )
  const names = points.map((point, index) =>
    index % every
      ? ''
      : html`<text x="${PAD.left + frame.band * (index + 0.5)}" y="${HEIGHT - 6}" text-anchor="middle" class="chart-tick">${point.label}</text>`
  )
  return html`${grid}${names}`
}

/** A hit area the height of the plot over each bucket: wider than the mark, so hover is easy. */
const _hits = (frame: Frame, points: readonly Point[]): Html[] =>
  points.map(
    (point, index) =>
      html`<rect x="${PAD.left + frame.band * index}" y="${PAD.top}" width="${frame.band}" height="${HEIGHT - PAD.top - PAD.bottom}" class="chart-hit" data-tip="${point.tip}"></rect>`
  )

/** A column per bucket: a count over time. Rounded at the data end, square at the baseline. */
export const columns = (points: readonly Point[], width: number): Html => {
  const frame = _frame(width, points)
  const thick = Math.min(BAR_MAX, Math.max(frame.band - 4, 2))
  const marks = points.map((point, index) => {
    const value = point.value ?? 0
    const height = _y(frame, 0) - _y(frame, value)
    const x = PAD.left + frame.band * (index + 0.5) - thick / 2
    return value ? html`<path d="${_column(x, _y(frame, 0), thick, height)}" class="chart-column"></path>` : ''
  })
  return _svg(frame, html`${_axes(frame, points, formatCount)}${marks}${_hits(frame, points)}`)
}

const _column = (x: number, base: number, thick: number, height: number): string => {
  const r = Math.min(4, height, thick / 2)
  const top = base - height
  return `M ${x} ${base} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + thick - r} Q ${x + thick} ${top} ${x + thick} ${top + r} V ${base} Z`
}

/** A line through the buckets that have a value; a gap where a bucket has none. */
export const line = (points: readonly Point[], width: number, format: (value: number) => string): Html => {
  const frame = _frame(width, points)
  const at = (index: number, value: number) =>
    `${(PAD.left + frame.band * (index + 0.5)).toFixed(1)},${_y(frame, value).toFixed(1)}`
  const paths = _runs(points, at).map((run) => html`<polyline points="${run.join(' ')}" class="chart-line"></polyline>`)
  const dots = points.map((point, index) => {
    const [x, y] = point.value === null ? [] : at(index, point.value).split(',')
    return x ? html`<circle cx="${x}" cy="${y}" r="4" class="chart-dot"></circle>` : ''
  })
  return _svg(frame, html`${_axes(frame, points, format)}${paths}${dots}${_hits(frame, points)}`)
}

/** The stretches of consecutive buckets with a value, each as the points of one polyline. */
const _runs = (points: readonly Point[], at: (index: number, value: number) => string): string[][] => {
  const runs: string[][] = [[]]
  for (const [index, point] of points.entries()) {
    if (point.value === null) {
      runs.push([])
    } else {
      runs[runs.length - 1]?.push(at(index, point.value))
    }
  }
  return runs.filter((run) => run.length > 1)
}

/** A legend for two series drawn over time: a swatch and a name each — identity is never color alone. */
const _seriesLegend = (series: readonly { label: string; className: string }[]): Html => html`
  <ul class="chart-legend chart-legend-inline">
    ${series.map((each) => html`<li><span class="chart-swatch ${each.className}"></span><span class="chart-legend-label">${each.label}</span></li>`)}
  </ul>
`

/**
 * A sprint's burndown (ADR-0029): what was left each day as a line, and the ideal — a straight run
 * from the starting scope to nothing on the last day — as a dashed, recessive reference.
 */
export const burndown = (
  points: readonly Point[],
  ideal: readonly number[],
  width: number,
  format: (value: number) => string
): Html => {
  // One bucket per day; the scale reaches whichever is higher that day, the remaining or the ideal.
  const tallest = points.map((point, index) => ({ ...point, value: Math.max(point.value ?? 0, ideal[index] ?? 0) }))
  const frame = _frame(width, tallest)
  const at = (index: number, value: number) =>
    `${(PAD.left + frame.band * (index + 0.5)).toFixed(1)},${_y(frame, value).toFixed(1)}`
  const guide = html`<polyline points="${ideal.map((value, index) => at(index, value)).join(' ')}" class="chart-ideal"></polyline>`
  const paths = _runs(points, at).map((run) => html`<polyline points="${run.join(' ')}" class="chart-line"></polyline>`)
  const legend = _seriesLegend([
    { label: 'Restante', className: 'chart-swatch-line' },
    { label: 'Ideal', className: 'chart-swatch-ideal' }
  ])
  return html`${legend}${_svg(frame, html`${_axes(frame, points, format)}${guide}${paths}${_hits(frame, points)}`)}`
}

export type Pair = { label: string; first: number; second: number; tip: string }

/** Two columns per bucket, side by side with a 2px gap: two measures of one unit, on one axis. */
export const pairedColumns = (pairs: readonly Pair[], names: readonly [string, string], width: number): Html => {
  const points = pairs.map((pair) => ({ label: pair.label, value: Math.max(pair.first, pair.second), tip: pair.tip }))
  const frame = _frame(width, points)
  const thick = Math.min(BAR_MAX, Math.max((frame.band - 8) / 2, 2))
  const mark = (index: number, value: number, side: 0 | 1) => {
    const x = PAD.left + frame.band * (index + 0.5) - thick - 1 + side * (thick + 2)
    const height = _y(frame, 0) - _y(frame, value)
    return value
      ? html`<path d="${_column(x, _y(frame, 0), thick, height)}" class="chart-column chart-series-${side + 1}"></path>`
      : ''
  }
  const marks = pairs.map((pair, index) => html`${mark(index, pair.first, 0)}${mark(index, pair.second, 1)}`)
  const legend = _seriesLegend([
    { label: names[0], className: 'chart-series-1' },
    { label: names[1], className: 'chart-series-2' }
  ])
  return html`${legend}${_svg(frame, html`${_axes(frame, points, formatCount)}${marks}${_hits(frame, points)}`)}`
}

const _svg = (frame: Frame, body: Html): Html =>
  html`<svg class="chart-plot" width="${frame.width}" height="${HEIGHT}" viewBox="0 0 ${frame.width} ${HEIGHT}">${body}</svg>`

let tip: HTMLElement | undefined

/** One floating tooltip for every chart under `root`, following the pointer over a `[data-tip]` mark. */
export const bindTips = (root: HTMLElement): void => {
  tip ??= Object.assign(document.createElement('div'), { className: 'chart-tip glass', hidden: true })
  if (!tip.isConnected) {
    document.body.append(tip)
  }
  const box = tip
  root.addEventListener('pointermove', (event) => {
    const mark = (event.target as Element).closest<HTMLElement | SVGElement>('[data-tip]')
    box.hidden = !mark
    if (mark) {
      box.replaceChildren(mark.dataset.tip ?? '')
      box.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`
    }
  })
  root.addEventListener('pointerleave', () => {
    box.hidden = true
  })
}
