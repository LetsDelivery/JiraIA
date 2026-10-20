import type { LinearElement, Point } from './elements'

/**
 * The path a line or an arrow takes through its points (ADR-0017): straight segments, a smooth curve, or
 * elbows — only horizontal and vertical runs, as in a flowchart. In the element's own coordinates.
 */
const elbowBetween = (a: Point, b: Point, horizontalFirst: boolean): Point[] => {
  if (a[0] === b[0] || a[1] === b[1]) {
    return [b]
  }
  if (horizontalFirst) {
    const middle = (a[0] + b[0]) / 2
    return [[middle, a[1]], [middle, b[1]], b]
  }
  const middle = (a[1] + b[1]) / 2
  return [[a[0], middle], [b[0], middle], b]
}

/** Elbows through every point; the first run follows the wider of the two distances. */
export const elbowPoints = (points: readonly Point[]): Point[] => {
  const [first] = points
  if (!first) {
    return []
  }
  const routed: Point[] = [first]
  for (const [index, point] of points.slice(1).entries()) {
    const from = points[index] as Point
    routed.push(...elbowBetween(from, point, Math.abs(point[0] - from[0]) >= Math.abs(point[1] - from[1])))
  }
  return routed
}

/** A curve through two points needs a third to bend through: a fifth of the length to the side. */
export const curvePoints = (points: readonly Point[]): Point[] => {
  if (points.length !== 2) {
    return [...points]
  }
  const [[ax, ay], [bx, by]] = points as [Point, Point]
  const bend = 0.2
  return [
    [ax, ay],
    [(ax + bx) / 2 - (by - ay) * bend, (ay + by) / 2 + (bx - ax) * bend],
    [bx, by]
  ]
}

/** The points the drawing goes through, before any smoothing. */
export const routeOf = (element: Pick<LinearElement, 'points' | 'arrowType'>): Point[] => {
  if (element.arrowType === 'elbow') {
    return elbowPoints(element.points)
  }
  return element.arrowType === 'curved' ? curvePoints(element.points) : [...element.points]
}

/** The two points that set the direction a tip points at, at the start or at the end. */
export const tipSegment = (route: readonly Point[], end: 'start' | 'end'): [Point, Point] | undefined => {
  if (route.length < 2) {
    return undefined
  }
  const last = route.length - 1
  return end === 'end' ? [route[last - 1] as Point, route[last] as Point] : [route[1] as Point, route[0] as Point]
}
