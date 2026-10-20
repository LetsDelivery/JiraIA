import rough from 'roughjs'
import type { Options } from 'roughjs/bin/core'

import { type Html, html, raw } from '@/lib/html'

import { arrowheadPath } from './arrowheads'
import {
  type Element,
  type FrameElement,
  type FreedrawElement,
  type ImageElement,
  type LinearElement,
  type Point,
  type ShapeElement,
  type TextElement,
  TRANSPARENT
} from './elements'
import { routeOf, tipSegment } from './routes'
import { FONT_STACK, lineHeightOf, measureText } from './text-layout'

/**
 * Elements as SVG (ADR-0017). Outlines and fills come from rough.js, seeded per element so the wobble is
 * the same everywhere; roughness 0 draws clean lines. Each element is drawn in its own coordinates and
 * placed with one transform, so moving it reuses the drawing.
 */
const generator = rough.generator()

const DASHES: Record<Element['strokeStyle'], (width: number) => string | null> = {
  solid: () => null,
  dashed: (width) => `${8 + width * 2} ${8 + width * 2}`,
  dotted: (width) => `${Math.max(1, width / 2)} ${6 + width * 2}`
}

const options = (element: Element): Options => ({
  seed: element.seed,
  roughness: element.roughness,
  bowing: element.roughness ? 1 : 0,
  strokeWidth: element.strokeWidth,
  disableMultiStroke: element.roughness === 0,
  preserveVertices: element.roughness < 2,
  hachureGap: 4 + element.strokeWidth * 2,
  fillWeight: Math.max(1, element.strokeWidth / 2)
})

type Draw = (opts: Options) => ReturnType<typeof generator.path>

const fillPaths = (element: Element, draw: Draw): string[] => {
  if (element.backgroundColor === TRANSPARENT) {
    return []
  }
  const fill = draw({
    ...options(element),
    stroke: 'none',
    fill: element.backgroundColor,
    fillStyle: element.fillStyle
  })
  return generator
    .toPaths(fill)
    .filter((each) => each.fill || each.stroke !== 'none')
    .map(
      (path) =>
        `<path d="${path.d}" fill="${path.fill ?? 'none'}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}"/>`
    )
}

const outlinePaths = (element: Element, draw: Draw): string[] => {
  if (element.strokeColor === TRANSPARENT) {
    return []
  }
  const dash = DASHES[element.strokeStyle](element.strokeWidth)
  const attributes = `fill="none" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}`
  const outline = draw({ ...options(element), stroke: element.strokeColor })
  return generator
    .toPaths(outline)
    .filter((each) => each.stroke !== 'none')
    .map((path) => `<path d="${path.d}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" ${attributes}/>`)
}

/** The fill, then the outline, each as rough paths; a transparent fill or stroke draws nothing. */
const sketch = (element: Element, draw: Draw): string =>
  [...fillPaths(element, draw), ...outlinePaths(element, draw)].join('')

/** A rectangle with corners of radius `r`, as path data rough.js can follow. */
const roundedRect = (w: number, h: number, r: number): string => {
  const radius = Math.min(r, w / 2, h / 2)
  if (radius <= 0) {
    return `M0 0 H${w} V${h} H0 Z`
  }
  return `M${radius} 0 H${w - radius} Q${w} 0 ${w} ${radius} V${h - radius} Q${w} ${h} ${w - radius} ${h} H${radius} Q0 ${h} 0 ${h - radius} V${radius} Q0 0 ${radius} 0 Z`
}

const roundedDiamond = (w: number, h: number, r: number): string => {
  const points: Point[] = [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2]
  ]
  if (r <= 0) {
    return `M${points.map(([x, y]) => `${x} ${y}`).join(' L')} Z`
  }
  const t = Math.min(0.3, r / Math.max(Math.hypot(w / 2, h / 2), 1))
  const near = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const parts = points.map((corner, index) => {
    const before = points[(index + 3) % 4] as Point
    const after = points[(index + 1) % 4] as Point
    const [inPoint, outPoint] = [near(corner, before), near(corner, after)]
    return `${index ? 'L' : 'M'}${inPoint[0]} ${inPoint[1]} Q${corner[0]} ${corner[1]} ${outPoint[0]} ${outPoint[1]}`
  })
  return `${parts.join(' ')} Z`
}

const SHAPES: Record<ShapeElement['type'], (element: ShapeElement) => string> = {
  rectangle: (element) =>
    sketch(element, (opts) => generator.path(roundedRect(element.width, element.height, element.roundness), opts)),
  ellipse: (element) =>
    sketch(element, (opts) =>
      generator.ellipse(element.width / 2, element.height / 2, element.width, element.height, opts)
    ),
  diamond: (element) =>
    sketch(element, (opts) => generator.path(roundedDiamond(element.width, element.height, element.roundness), opts))
}

const tipMarkup = (element: LinearElement, route: Point[], end: 'start' | 'end'): string => {
  const kind = end === 'start' ? element.startArrowhead : element.endArrowhead
  const segment = tipSegment(route, end)
  if (!kind || !segment) {
    return ''
  }
  const [[fx, fy], [tx, ty]] = segment
  const tip = arrowheadPath(kind, { x: tx, y: ty }, { x: fx, y: fy }, element.strokeWidth)
  const fill = tip.filled ? element.strokeColor : 'none'
  return `<path d="${tip.d}" fill="${fill}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
}

const linear = (element: LinearElement): string => {
  const route = routeOf(element)
  const draw: Draw = (opts) =>
    element.arrowType === 'curved' ? generator.curve(route, opts) : generator.linearPath(route, opts)
  const body = sketch({ ...element, backgroundColor: TRANSPARENT }, draw)
  return body + tipMarkup(element, route, 'start') + tipMarkup(element, route, 'end')
}

/** A pen stroke, smoothed through the midpoints of its points. */
const freedraw = (element: FreedrawElement): string => {
  const points = element.points
  const [first] = points
  if (!first) {
    return ''
  }
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index] as Point
    return `Q${previous[0]} ${previous[1]} ${(previous[0] + point[0]) / 2} ${(previous[1] + point[1]) / 2}`
  })
  const last = points[points.length - 1] as Point
  const d = `M${first[0]} ${first[1]} ${segments.join(' ')} L${last[0]} ${last[1]}`
  return `<path d="${d}" fill="none" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth * 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`
}

const ANCHOR = { left: 'start', center: 'middle', right: 'end' } as const

/** A text's lines, each a `tspan`, wrapped as its layout says. Escaped: words come from people. */
export const textMarkup = (element: TextElement): Html => {
  const { lines } = measureText(element, element.autoResize && !element.containerId ? null : element.width)
  const x = { left: 0, center: element.width / 2, right: element.width }[element.textAlign]
  const step = lineHeightOf(element)
  return html`<text x="${x}" font-family="${FONT_STACK[element.fontFamily]}" font-size="${element.fontSize}" fill="${element.strokeColor}" text-anchor="${ANCHOR[element.textAlign]}" dominant-baseline="central" xml:space="preserve">${lines.map(
    (line, index) => html`<tspan x="${x}" y="${(index + 0.5) * step}">${line || ' '}</tspan>`
  )}</text>`
}

const image = (element: ImageElement): Html =>
  html`<image class="wb-image" href="${element.url}" width="${element.width}" height="${element.height}" preserveAspectRatio="none"></image>`

const frame = (element: FrameElement): Html =>
  html`<rect width="${element.width}" height="${element.height}" rx="8" fill="${element.backgroundColor === TRANSPARENT ? 'none' : element.backgroundColor}" stroke="${element.strokeColor}" stroke-width="1.5"></rect>
    <text class="wb-frame-name" x="2" y="-8" font-size="14">${element.name}</text>`

const cache = new Map<string, string>()

/** What an element looks like, apart from where it is: the key its drawing is kept under. */
const looks = (element: Element): string => {
  const {
    x: _x,
    y: _y,
    z: _z,
    angle: _angle,
    locked: _locked,
    groupIds: _g,
    frameId: _f,
    boundElements: _b,
    link: _l,
    ...rest
  } = element
  return JSON.stringify(rest)
}

const sketched = (element: Element): string => {
  const key = looks(element)
  const known = cache.get(key)
  if (known !== undefined) {
    return known
  }
  const drawn =
    element.type === 'line' || element.type === 'arrow'
      ? linear(element)
      : element.type === 'freedraw'
        ? freedraw(element)
        : SHAPES[element.type as ShapeElement['type']](element as ShapeElement)
  if (cache.size > 4000) {
    cache.clear()
  }
  cache.set(key, drawn)
  return drawn
}

const body = (element: Element): Html => {
  if (element.type === 'text') {
    return textMarkup(element)
  }
  if (element.type === 'image') {
    return image(element)
  }
  return element.type === 'frame' ? frame(element) : raw(sketched(element))
}

/** Where the element sits: moved to its corner, turned around its centre. */
export const placement = (element: Element): string => {
  const degrees = (element.angle * 180) / Math.PI
  return `translate(${element.x} ${element.y})${degrees ? ` rotate(${degrees} ${element.width / 2} ${element.height / 2})` : ''}`
}

export const elementMarkup = (element: Element): Html =>
  html`<g class="wb-element" data-element="${element.id}" transform="${placement(element)}" opacity="${element.opacity / 100}">${body(element)}${element.link ? html`<circle class="wb-link-dot" cx="${element.width}" cy="0" r="5"></circle>` : ''}</g>`
