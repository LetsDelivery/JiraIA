import { anchorPoint, bindingAt } from './bindings'
import { type Binding, isLinear, type LinearElement, newLinear, normalizePoints, type Point } from './elements'
import type { Vec } from './geometry'
import { pointToGrid } from './snapping'
import type { Whiteboard } from './whiteboard'

/**
 * Drawing and reshaping lines and arrows (Etapa 4d-b, ADR-0017). An end dropped on or near a shape ties
 * to the nearest middle of its sides, and the shape is lit while the end is over it; a point dragged in
 * the middle reshapes the line, and the small handle between two points adds one.
 */
export type LinearGesture = { kind: 'linear'; id: string; from: Vec; start: Binding | null; end: Binding | null }
export type PointGesture = { kind: 'point'; id: string; index: number; end: Binding | null }

const CLICK = 4

/** Where an end goes: on the anchor of the shape under it, or where the pointer is. */
const endAt = (board: Whiteboard, at: Vec, skip: string, avoid?: string): { point: Vec; binding: Binding | null } => {
  const binding = bindingAt(
    board.hittable().filter((element) => element.id !== avoid),
    at,
    skip,
    board.zoom
  )
  const target = binding ? board.scene.get(binding.elementId) : undefined
  board.hover = target?.id ?? null
  return { point: target && binding ? anchorPoint(target, binding.anchor) : pointToGrid(at, board.grid), binding }
}

export const startLinear = (board: Whiteboard, type: 'line' | 'arrow', at: Vec): LinearGesture => {
  const { point, binding } = endAt(board, at, '')
  const element = newLinear(type, point, board.style, board.scene.top)
  board.scene.undo.stopCapturing()
  board.scene.put(element)
  board.select([element.id])
  return { kind: 'linear', id: element.id, from: at, start: binding, end: null }
}

export const followLinear = (board: Whiteboard, gesture: LinearGesture, at: Vec): void => {
  const element = board.scene.get(gesture.id)
  if (!element || !isLinear(element)) {
    return
  }
  const { point, binding } = endAt(board, at, gesture.id, gesture.start?.elementId)
  gesture.end = binding
  board.scene.put({
    ...element,
    points: [
      [0, 0],
      [point.x - element.x, point.y - element.y]
    ]
  })
}

/** A click with the line tool draws nothing; a drag leaves the line, tied at whichever ends it can be. */
export const finishLinear = (board: Whiteboard, gesture: LinearGesture, at: Vec): void => {
  const element = board.scene.get(gesture.id)
  board.hover = null
  if (!element || !isLinear(element)) {
    return
  }
  if (Math.hypot(at.x - gesture.from.x, at.y - gesture.from.y) < CLICK) {
    board.scene.remove([element.id])
    return
  }
  board.scene.put(normalizePoints(element))
  board.scene.tie(element.id, 'startBinding', gesture.start)
  board.scene.tie(element.id, 'endBinding', gesture.end)
  board.refitFrames([board.scene.get(element.id) ?? element])
}

// ---------- Points ----------

const absolute = (element: LinearElement): Vec[] =>
  element.points.map(([px, py]) => ({ x: element.x + px, y: element.y + py }))

/** Grabs a point; with `insert`, a new point in the middle of the segment after `index`. */
export const startPoint = (board: Whiteboard, id: string, index: number, insert: boolean): PointGesture | undefined => {
  const element = board.scene.get(id)
  if (!element || !isLinear(element) || element.locked) {
    return undefined
  }
  board.scene.undo.stopCapturing()
  if (insert) {
    const origin: Point = [0, 0]
    const [a, b] = [element.points[index] ?? origin, element.points[index + 1] ?? origin]
    const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    board.scene.put({
      ...element,
      points: [...element.points.slice(0, index + 1), middle, ...element.points.slice(index + 1)]
    })
    return { kind: 'point', id, index: index + 1, end: null }
  }
  return { kind: 'point', id, index, end: null }
}

const endOf = (element: LinearElement, index: number): 'startBinding' | 'endBinding' | undefined =>
  index === 0 ? 'startBinding' : index === element.points.length - 1 ? 'endBinding' : undefined

export const followPoint = (board: Whiteboard, gesture: PointGesture, at: Vec): void => {
  const element = board.scene.get(gesture.id)
  if (!element || !isLinear(element)) {
    return
  }
  const end = endOf(element, gesture.index)
  const other = end === 'startBinding' ? element.endBinding : element.startBinding
  const { point, binding } = end
    ? endAt(board, at, element.id, other?.elementId)
    : { point: pointToGrid(at, board.grid), binding: null }
  gesture.end = binding
  const points = absolute(element).map((each, index) => (index === gesture.index ? point : each))
  // While dragged, the end is free; it is tied again on release.
  const loose = end ? { [end]: null } : {}
  board.scene.put(
    normalizePoints({ ...element, ...loose, x: 0, y: 0, points: points.map((each) => [each.x, each.y] as Point) })
  )
}

export const finishPoint = (board: Whiteboard, gesture: PointGesture): void => {
  const element = board.scene.get(gesture.id)
  board.hover = null
  if (element && isLinear(element)) {
    const end = endOf(element, gesture.index)
    if (end) {
      board.scene.tie(element.id, end, gesture.end)
    }
  }
}

/** A point in the middle removed: the line straightens there. Ends stay. */
export const removePoint = (board: Whiteboard, id: string, index: number): void => {
  const element = board.scene.get(id)
  if (element && isLinear(element) && index > 0 && index < element.points.length - 1) {
    board.scene.step(() =>
      board.scene.put(normalizePoints({ ...element, points: element.points.filter((_, each) => each !== index) }))
    )
  }
}
