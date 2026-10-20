import { type Element, hasPoints, isText, type Point } from './elements'

/**
 * Where things are on a whiteboard (ADR-0017): the box of a turned element, what a click lands on, and
 * the arithmetic of moving, resizing and rotating. Pure, so it is tested alone.
 */
export type Vec = { x: number; y: number }
export type Box = { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const centerOf = (box: Box): Vec => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

export const rotate = (point: Vec, around: Vec, angle: number): Vec => {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  const [dx, dy] = [point.x - around.x, point.y - around.y]
  return { x: around.x + dx * cos - dy * sin, y: around.y + dx * sin + dy * cos }
}

/** A board point in the element's own frame: as if it were not turned. */
export const toLocal = (element: Element, point: Vec): Vec => rotate(point, centerOf(element), -element.angle)

const corners = (box: Box): Vec[] => [
  { x: box.x, y: box.y },
  { x: box.x + box.width, y: box.y },
  { x: box.x + box.width, y: box.y + box.height },
  { x: box.x, y: box.y + box.height }
]

const around = (points: readonly Vec[]): Box => {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const [x, y] = [Math.min(...xs), Math.min(...ys)]
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** The upright box that holds the element as drawn, turned or not. */
export const boundsOf = (element: Element): Box => {
  if (!element.angle) {
    return { x: element.x, y: element.y, width: element.width, height: element.height }
  }
  const center = centerOf(element)
  return around(corners(element).map((corner) => rotate(corner, center, element.angle)))
}

/** The box around several elements; an empty box at the origin for none. */
export const commonBounds = (elements: readonly Element[]): Box => {
  if (!elements.length) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  return around(elements.flatMap((element) => corners(boundsOf(element))))
}

export const intersects = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height

export const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height

const distanceToSegment = (point: Vec, a: Vec, b: Vec): number => {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** The points of a line or a stroke, on the board. */
export const absolutePoints = (element: Element & { points: Point[] }): Vec[] =>
  element.points.map(([px, py]) => rotate({ x: element.x + px, y: element.y + py }, centerOf(element), element.angle))

export const nearPolyline = (points: readonly Vec[], point: Vec, tolerance: number): boolean =>
  points.some((each, index) => index > 0 && distanceToSegment(point, points[index - 1] as Vec, each) <= tolerance)

const insideShape = (element: Element, local: Vec, tolerance: number): boolean => {
  const [cx, cy] = [element.x + element.width / 2, element.y + element.height / 2]
  const [rx, ry] = [element.width / 2 + tolerance, element.height / 2 + tolerance]
  if (element.type === 'ellipse') {
    return ((local.x - cx) / rx) ** 2 + ((local.y - cy) / ry) ** 2 <= 1
  }
  if (element.type === 'diamond') {
    return Math.abs(local.x - cx) / rx + Math.abs(local.y - cy) / ry <= 1
  }
  return Math.abs(local.x - cx) <= rx && Math.abs(local.y - cy) <= ry
}

/** Whether a click at `point` lands on the element; `tolerance` makes a thin line easy to pick. */
export const hits = (element: Element, point: Vec, tolerance: number): boolean => {
  if (hasPoints(element)) {
    const points = absolutePoints(element)
    return points.length === 1
      ? Math.hypot(point.x - (points[0]?.x ?? 0), point.y - (points[0]?.y ?? 0)) <= tolerance
      : nearPolyline(points, point, tolerance + element.strokeWidth / 2)
  }
  if (element.type === 'frame') {
    return frameEdgeHit(element, toLocal(element, point), tolerance)
  }
  return insideShape(element, toLocal(element, point), tolerance)
}

/** A frame is picked by its border or its name above it, so what is inside it stays reachable. */
const frameEdgeHit = (frame: Element, local: Vec, tolerance: number): boolean => {
  const title =
    local.y >= frame.y - 28 &&
    local.y <= frame.y &&
    local.x >= frame.x &&
    local.x <= frame.x + Math.max(frame.width, 80)
  const inner = {
    x: frame.x + tolerance,
    y: frame.y + tolerance,
    width: frame.width - 2 * tolerance,
    height: frame.height - 2 * tolerance
  }
  const outer = insideShape({ ...frame, type: 'rectangle' }, local, tolerance)
  return title || (outer && !contains(inner, { ...local, width: 0, height: 0 }))
}

const SIGNS: Record<Handle, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1]
}

/**
 * The box after dragging `handle` by `delta` (board units), for an element turned by `angle`: the
 * opposite side stays where it was on the board. With `keepRatio` (Shift) the proportions hold.
 */
export const resizeBox = (box: Box, angle: number, handle: Handle, delta: Vec, keepRatio: boolean, min = 8): Box => {
  const local = rotate(delta, { x: 0, y: 0 }, -angle)
  const [sx, sy] = SIGNS[handle]
  let width = Math.max(min, box.width + sx * local.x)
  let height = Math.max(min, box.height + sy * local.y)
  if (keepRatio && box.width && box.height) {
    const scale =
      sx && sy ? Math.max(width / box.width, height / box.height) : sx ? width / box.width : height / box.height
    ;[width, height] = [box.width * scale, box.height * scale]
  }
  // The fixed point: the opposite edge's middle, or the opposite corner, as it sits on the board.
  const fixedLocal = { x: box.x + (box.width * (1 - sx)) / 2, y: box.y + (box.height * (1 - sy)) / 2 }
  const fixed = rotate(fixedLocal, centerOf(box), angle)
  const offset = rotate(
    { x: (width * (1 - sx)) / 2 - width / 2, y: (height * (1 - sy)) / 2 - height / 2 },
    { x: 0, y: 0 },
    angle
  )
  const center = { x: fixed.x - offset.x, y: fixed.y - offset.y }
  return { x: center.x - width / 2, y: center.y - height / 2, width, height }
}

/** The angle a rotation handle dragged to `point` gives; with `snap` (Shift), in steps of 15°. */
export const angleTo = (center: Vec, point: Vec, snap: boolean): number => {
  const raw = Math.atan2(point.y - center.y, point.x - center.x) + Math.PI / 2
  const step = Math.PI / 12
  const angle = snap ? Math.round(raw / step) * step : raw
  return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

/**
 * An element fitted into a new box: shapes take the box; lines and strokes scale their points; text
 * scales its font when it is scaled as part of a group.
 */
export const fitInto = <T extends Element>(element: T, from: Box, to: Box, scaleText: boolean): T => {
  const [kx, ky] = [from.width ? to.width / from.width : 1, from.height ? to.height / from.height : 1]
  const moved = {
    ...element,
    x: to.x + (element.x - from.x) * kx,
    y: to.y + (element.y - from.y) * ky,
    width: element.width * kx,
    height: element.height * ky
  }
  if (hasPoints(element)) {
    return { ...moved, points: element.points.map(([px, py]) => [px * kx, py * ky] as Point) } as T
  }
  if (isText(element) && scaleText) {
    return { ...moved, fontSize: Math.max(4, element.fontSize * Math.min(kx, ky)) } as T
  }
  return moved as T
}
