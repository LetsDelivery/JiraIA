import {
  type Binding,
  type Element,
  isLinear,
  isText,
  type LinearElement,
  normalizePoints,
  type Point
} from './elements'
import { boundsOf, centerOf, rotate, toLocal, type Vec } from './geometry'

/**
 * Arrows tied to shapes (Etapa 4d-b, ADR-0017). An arrow's end keeps `{ elementId, anchor }`, the anchor
 * a point of the shape's box from [0, 0] to [1, 1] — [0, 0.5] is the middle of the left side. The shape
 * keeps the arrow in its `boundElements`, so either side finds the other. Whenever a shape moves,
 * resizes or turns, its arrows are drawn again from their anchors.
 */
export const ANCHORS: Point[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5]
]

/** Room between an arrow's tip and the outline it points at. */
const GAP = 6
/** How near a shape an arrow's end must come to tie itself to it. */
const REACH = 16

/** What an arrow may be tied to: anything with a box but another line or arrow, a stroke or a frame. */
export const bindable = (element: Element): boolean =>
  !isLinear(element) &&
  element.type !== 'freedraw' &&
  element.type !== 'frame' &&
  !(isText(element) && element.containerId)

/** An anchor on the board, a little outside the outline, so the tip does not cover the stroke. */
export const anchorPoint = (element: Element, anchor: Point): Vec => {
  const local = { x: element.x + anchor[0] * element.width, y: element.y + anchor[1] * element.height }
  const out = { x: anchor[0] - 0.5, y: anchor[1] - 0.5 }
  const length = Math.hypot(out.x, out.y) || 1
  const pushed = { x: local.x + (out.x / length) * GAP, y: local.y + (out.y / length) * GAP }
  return rotate(pushed, centerOf(element), element.angle)
}

/** The side of the shape nearest the point: the anchor an arrow ending there is tied to. */
export const nearestAnchor = (element: Element, point: Vec): Point => {
  const local = toLocal(element, point)
  const relative = { x: (local.x - element.x) / (element.width || 1), y: (local.y - element.y) / (element.height || 1) }
  const distance = ([ax, ay]: Point) => Math.hypot(ax - relative.x, ay - relative.y)
  return ANCHORS.reduce((best, each) => (distance(each) < distance(best) ? each : best))
}

/** The front-most element an arrow end at `point` ties to, if it comes near enough. */
export const bindingAt = (elements: readonly Element[], point: Vec, skip: string, zoom: number): Binding | null => {
  const reach = REACH / zoom
  const target = [...elements]
    .reverse()
    .find((element) => element.id !== skip && bindable(element) && near(element, point, reach))
  return target ? { elementId: target.id, anchor: nearestAnchor(target, point) } : null
}

const near = (element: Element, point: Vec, reach: number): boolean => {
  const box = boundsOf(element)
  return (
    point.x >= box.x - reach &&
    point.x <= box.x + box.width + reach &&
    point.y >= box.y - reach &&
    point.y <= box.y + box.height + reach
  )
}

/** The arrow's ends on the board: each from its anchor if tied, else where its points say. */
const ends = (arrow: LinearElement, get: (id: string) => Element | undefined): [Vec, Vec] => {
  const origin: Point = [0, 0]
  const [first, last] = [arrow.points[0] ?? origin, arrow.points[arrow.points.length - 1] ?? origin]
  const tied = (binding: Binding | null, fallback: Point): Vec => {
    const target = binding ? get(binding.elementId) : undefined
    return target
      ? anchorPoint(target, binding?.anchor ?? [0.5, 0.5])
      : { x: arrow.x + fallback[0], y: arrow.y + fallback[1] }
  }
  return [tied(arrow.startBinding, first), tied(arrow.endBinding, last)]
}

/** The arrow redrawn between its anchors; the points between keep their places on the board. */
export const followBindings = (arrow: LinearElement, get: (id: string) => Element | undefined): LinearElement => {
  if (!arrow.startBinding && !arrow.endBinding) {
    return arrow
  }
  const [start, end] = ends(arrow, get)
  const middle = arrow.points.slice(1, -1).map(([px, py]) => [arrow.x + px, arrow.y + py] as Point)
  const absolute: Point[] = [[start.x, start.y], ...middle, [end.x, end.y]]
  return normalizePoints({ ...arrow, x: 0, y: 0, angle: 0, points: absolute })
}

/** A shape's list of tied arrows with this one added, or removed. */
export const withArrow = (element: Element, arrowId: string, tied: boolean): Element => {
  const others = element.boundElements.filter((each) => each.id !== arrowId)
  return { ...element, boundElements: tied ? [...others, { id: arrowId, type: 'arrow' }] : others }
}
