import type { Element } from './elements'
import { type Box, boundsOf, type Vec } from './geometry'

/**
 * Snapping (Etapa 4d-b, ADR-0017): with the grid on, points fall on it; while moving, the selection's
 * edges and centre catch the other elements' edges and centres, and a guide shows the line they share.
 */
export const GRID = 20

/** How near, in screen pixels, a line must come to catch another. */
const CATCH = 6

export type Guide = { x1: number; y1: number; x2: number; y2: number }

export const toGrid = (value: number, grid: boolean): number => (grid ? Math.round(value / GRID) * GRID : value)

export const pointToGrid = (point: Vec, grid: boolean): Vec => ({ x: toGrid(point.x, grid), y: toGrid(point.y, grid) })

const lines = (box: Box, axis: 'x' | 'y'): number[] => {
  const [start, size] = axis === 'x' ? [box.x, box.width] : [box.y, box.height]
  return [start, start + size / 2, start + size]
}

/** The smallest shift that puts one of `mine` on one of `theirs`, if any is near enough. */
const nearest = (
  mine: readonly number[],
  theirs: readonly number[],
  reach: number
): { shift: number; at: number } | undefined => {
  let best: { shift: number; at: number } | undefined
  for (const line of mine) {
    for (const other of theirs) {
      const shift = other - line
      if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, at: other }
      }
    }
  }
  return best
}

/** A guide along a shared line, spanning the moving box and every element on that line. */
const guide = (axis: 'x' | 'y', at: number, boxes: readonly Box[]): Guide => {
  const span = {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.min(...boxes.map((box) => box.y)),
    width: Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x)),
    height: Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y))
  }
  return axis === 'x'
    ? { x1: at, y1: span.y, x2: at, y2: span.y + span.height }
    : { x1: span.x, y1: at, x2: span.x + span.width, y2: at }
}

const sharing = (boxes: readonly Box[], axis: 'x' | 'y', at: number): Box[] =>
  boxes.filter((box) => lines(box, axis).some((line) => Math.abs(line - at) < 0.5))

/**
 * Where a box being moved catches: the shift on each axis, and the guides to draw. On the grid, the
 * box's corner falls on it instead.
 */
export const snapBox = (
  moving: Box,
  others: readonly Element[],
  zoom: number,
  grid: boolean
): { dx: number; dy: number; guides: Guide[] } => {
  if (grid) {
    return { dx: toGrid(moving.x, true) - moving.x, dy: toGrid(moving.y, true) - moving.y, guides: [] }
  }
  const boxes = others.map(boundsOf)
  const reach = CATCH / zoom
  const x = nearest(
    lines(moving, 'x'),
    boxes.flatMap((box) => lines(box, 'x')),
    reach
  )
  const y = nearest(
    lines(moving, 'y'),
    boxes.flatMap((box) => lines(box, 'y')),
    reach
  )
  const moved = { ...moving, x: moving.x + (x?.shift ?? 0), y: moving.y + (y?.shift ?? 0) }
  const guides = [
    ...(x ? [guide('x', x.at, [moved, ...sharing(boxes, 'x', x.at)])] : []),
    ...(y ? [guide('y', y.at, [moved, ...sharing(boxes, 'y', y.at)])] : [])
  ]
  return { dx: x?.shift ?? 0, dy: y?.shift ?? 0, guides }
}
