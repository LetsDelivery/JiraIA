import {
  type Binding,
  type Element,
  isLinear,
  isText,
  type LinearElement,
  normalizePoints,
  type Point
} from './elements'
import { centerOf, rotate, toLocal, type Vec } from './geometry'

/**
 * Arrows tied to shapes (Etapa 4d-b, ADR-0017). An arrow's end keeps `{ elementId, anchor }`, the anchor
 * a point of the shape's box from [0, 0] to [1, 1] — [0, 0.5] is the middle of the left side. An end
 * dropped near the outline ties to the point of the outline toward it, or to a side's middle when it
 * comes close to one; dropped well inside, it ties to that very point. The shape keeps the arrow in its
 * `boundElements`, so either side finds the other. Whenever a shape moves, resizes or turns, its arrows
 * are drawn again from their anchors.
 */
export const ANCHORS: Point[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5]
]

/** Room between an arrow's tip and the outline it points at. */
const GAP = 6
/** How near the outline, on either side, an arrow's end must come to tie itself to it. */
const REACH = 16
/** How near a side's middle, in screen pixels, an end on the outline must come to take the middle. */
const SNAP = 10

/** What an arrow may be tied to: anything with a box but another line or arrow, a stroke or a frame. */
export const bindable = (element: Element): boolean =>
  !isLinear(element) &&
  element.type !== 'freedraw' &&
  element.type !== 'frame' &&
  !(isText(element) && element.containerId)

/**
 * Where the outline lies along the ray from the centre through an offset `(u, v)` — in halves of the
 * width and height — as a multiple of that offset: above 1 the offset is inside the shape.
 */
const outlineScale = (element: Element, u: number, v: number): number => {
  const [au, av] = [Math.abs(u), Math.abs(v)]
  const reach =
    element.type === 'ellipse' ? Math.hypot(au, av) : element.type === 'diamond' ? au + av : Math.max(au, av)
  return reach === 0 ? Number.POSITIVE_INFINITY : 1 / reach
}

/** A point in the shape's unturned frame, as an offset from its centre in halves of its size. */
const offsetOf = (element: Element, point: Vec) => {
  const local = toLocal(element, point)
  const [half, tall] = [element.width / 2 || 1, element.height / 2 || 1]
  const [u, v] = [(local.x - element.x - half) / half, (local.y - element.y - tall) / tall]
  return { u, v, scale: outlineScale(element, u, v), length: Math.hypot(u * half, v * tall) }
}

/** How far a point is outside the outline, in board units; negative inside. */
export const outsideBy = (element: Element, point: Vec): number => {
  const { scale, length } = offsetOf(element, point)
  return Number.isFinite(scale) ? length * (1 - scale) : -Math.min(element.width, element.height) / 2
}

/** An anchor on the board: on the outline, a little outside it so the tip does not cover the stroke; inside, as is. */
export const anchorPoint = (element: Element, anchor: Point): Vec => {
  const local = { x: element.x + anchor[0] * element.width, y: element.y + anchor[1] * element.height }
  const center = centerOf(element)
  const inside = outlineScale(element, (anchor[0] - 0.5) * 2, (anchor[1] - 0.5) * 2) > 1.001
  const out = { x: local.x - center.x, y: local.y - center.y }
  const length = Math.hypot(out.x, out.y) || 1
  const pushed = inside ? local : { x: local.x + (out.x / length) * GAP, y: local.y + (out.y / length) * GAP }
  return rotate(pushed, center, element.angle)
}

/** The side of the shape nearest the point: the anchor an arrow ending there is tied to. */
export const nearestAnchor = (element: Element, point: Vec): Point => {
  const local = toLocal(element, point)
  const relative = { x: (local.x - element.x) / (element.width || 1), y: (local.y - element.y) / (element.height || 1) }
  const distance = ([ax, ay]: Point) => Math.hypot(ax - relative.x, ay - relative.y)
  return ANCHORS.reduce((best, each) => (distance(each) < distance(best) ? each : best))
}

/** A point of the outline that comes within `SNAP` of a side's middle becomes that middle. */
const toMiddle = (element: Element, on: Point, zoom: number): Point => {
  const distance = ([ax, ay]: Point) => Math.hypot((ax - on[0]) * element.width, (ay - on[1]) * element.height)
  return ANCHORS.find((each) => distance(each) <= SNAP / zoom) ?? on
}

/** The anchor for an end at `point`: that point when well inside, else the outline toward it. */
export const anchorAt = (element: Element, point: Vec, zoom: number): Point => {
  const { u, v, scale } = offsetOf(element, point)
  if (!Number.isFinite(scale) || outsideBy(element, point) < -REACH / zoom) {
    return Number.isFinite(scale) ? [(u + 1) / 2, (v + 1) / 2] : [0.5, 0.5]
  }
  return toMiddle(element, [(u * scale + 1) / 2, (v * scale + 1) / 2], zoom)
}

/** The front-most element an arrow end at `point` ties to: one it is inside, or whose outline it nears. */
export const bindingAt = (elements: readonly Element[], point: Vec, skip: string, zoom: number): Binding | null => {
  const reach = REACH / zoom
  const target = [...elements]
    .reverse()
    .find((element) => element.id !== skip && bindable(element) && outsideBy(element, point) <= reach)
  return target ? { elementId: target.id, anchor: anchorAt(target, point, zoom) } : null
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
