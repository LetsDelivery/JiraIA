import {
  type Element,
  type FreedrawElement,
  hasPoints,
  newFrame,
  newFreedraw,
  newShape,
  normalizePoints,
  type Point
} from './elements'
import {
  angleTo,
  type Box,
  centerOf,
  commonBounds,
  fitInto,
  type Handle,
  hits,
  resizeBox,
  rotate,
  type Vec
} from './geometry'
import {
  finishLinear,
  finishPoint,
  followLinear,
  followPoint,
  type LinearGesture,
  type PointGesture,
  startLinear
} from './gesture-linear'
import { finishMove, followMove, type MoveGesture, startMove } from './gesture-move'
import { pointToGrid } from './snapping'
import type { Whiteboard } from './whiteboard'

/**
 * What a drag on the board does (ADR-0017), from the press to the release: pan, move, resize, rotate,
 * select an area, draw a new element, edit a line's points, or erase. Each gesture keeps what the
 * elements were when it started, so a frame of the drag is computed from the start and never drifts.
 */
export type Gesture =
  | { kind: 'pan'; from: Vec; view: Vec }
  | MoveGesture
  | { kind: 'resize'; from: Vec; handle: Handle; originals: Element[]; box: Box; angle: number }
  | { kind: 'rotate'; originals: Element[]; center: Vec; start: number }
  | { kind: 'marquee'; from: Vec; to: Vec; additive: readonly string[] }
  | { kind: 'create'; from: Vec; id: string }
  | LinearGesture
  | PointGesture
  | { kind: 'erase'; ids: Set<string> }

const CLICK = 4

export const DEFAULT_SIZES = {
  rectangle: [200, 120],
  diamond: [180, 140],
  ellipse: [180, 120],
  frame: [480, 360]
} as const

/** The box from a press to where the pointer is; with Shift, a square. */
export const dragBox = (from: Vec, to: Vec, square: boolean): Box => {
  let [width, height] = [Math.abs(to.x - from.x), Math.abs(to.y - from.y)]
  if (square) {
    width = height = Math.max(width, height)
  }
  return { x: to.x < from.x ? from.x - width : from.x, y: to.y < from.y ? from.y - height : from.y, width, height }
}

// ---------- Starting ----------

/** A new shape, frame or stroke under the pointer — or a line or an arrow, tied where it starts. */
export const startCreate = (board: Whiteboard, pressed: Vec): Gesture => {
  const tool = board.tool
  const at = pointToGrid(pressed, board.grid)
  if (tool === 'line' || tool === 'arrow') {
    return startLinear(board, tool, at)
  }
  const box = { x: at.x, y: at.y, width: 0, height: 0 }
  const element: Element =
    tool === 'frame'
      ? newFrame(box, board.scene.bottom)
      : tool === 'freedraw'
        ? newFreedraw(pressed, board.style, board.scene.top)
        : newShape(tool as 'rectangle' | 'ellipse' | 'diamond', box, board.style, board.scene.top)
  board.scene.undo.stopCapturing()
  board.scene.put(element)
  board.select([element.id])
  return { kind: 'create', from: at, id: element.id }
}

export const startTransform = (board: Whiteboard, at: Vec, target: Element): Gesture => {
  const selected = board.selected()
  if (target.locked || selected.some((element) => element.locked)) {
    return { kind: 'marquee', from: at, to: at, additive: [] }
  }
  return startMove(board, at, selected)
}

export const startResize = (board: Whiteboard, at: Vec, handle: Handle): Gesture => {
  const originals = board.selected()
  const [only] = originals
  board.scene.undo.stopCapturing()
  const box =
    originals.length === 1 && only
      ? { x: only.x, y: only.y, width: only.width, height: only.height }
      : commonBounds(originals)
  return { kind: 'resize', from: at, handle, originals, box, angle: originals.length === 1 ? (only?.angle ?? 0) : 0 }
}

export const startRotate = (board: Whiteboard, at: Vec): Gesture => {
  const originals = board.selected()
  board.scene.undo.stopCapturing()
  const center = centerOf(originals.length === 1 && originals[0] ? originals[0] : commonBounds(originals))
  return { kind: 'rotate', originals, center, start: angleTo(center, at, false) }
}

// ---------- Following the pointer ----------

const resized = (gesture: Extract<Gesture, { kind: 'resize' }>, at: Vec, keepRatio: boolean): Element[] => {
  const delta = { x: at.x - gesture.from.x, y: at.y - gesture.from.y }
  const box = resizeBox(gesture.box, gesture.angle, gesture.handle, delta, keepRatio || gesture.originals.length > 1)
  const [only] = gesture.originals
  if (gesture.originals.length === 1 && only && !hasPoints(only)) {
    // A text resized by hand stops growing with its words and wraps to the width it was given.
    return [{ ...only, ...box, ...(only.type === 'text' ? { autoResize: false } : {}) } as Element]
  }
  return gesture.originals.map((element) => fitInto(element, gesture.box, box, gesture.originals.length > 1))
}

/** A line or a stroke turns by turning its points, so its ends stay where its anchors put them. */
const turned = (element: Element, center: Vec, turn: number): Element => {
  const moved = rotate(centerOf(element), center, turn)
  if (hasPoints(element)) {
    const points = element.points.map(([px, py]) => {
      const point = rotate({ x: element.x + px, y: element.y + py }, center, turn)
      return [point.x, point.y] as Point
    })
    return normalizePoints({ ...element, x: 0, y: 0, angle: 0, points })
  }
  return {
    ...element,
    x: moved.x - element.width / 2,
    y: moved.y - element.height / 2,
    angle: (element.angle + turn) % (2 * Math.PI)
  }
}

const rotated = (gesture: Extract<Gesture, { kind: 'rotate' }>, at: Vec, snap: boolean): Element[] => {
  const turn = angleTo(gesture.center, at, snap) - gesture.start
  return gesture.originals.map((element) => turned(element, gesture.center, turn))
}

/** A new element following the drag: a box from the press, or a stroke adding a point. */
const grown = (
  board: Whiteboard,
  gesture: Extract<Gesture, { kind: 'create' }>,
  at: Vec,
  shift: boolean
): Element | undefined => {
  const element = board.scene.get(gesture.id)
  if (element?.type === 'freedraw') {
    const point: Point = [at.x - element.x, at.y - element.y]
    return { ...element, points: [...element.points, point] } as FreedrawElement
  }
  return element ? { ...element, ...dragBox(gesture.from, pointToGrid(at, board.grid), shift) } : undefined
}

/** One frame of a drag: the elements as the gesture puts them now. */
export const follow = (board: Whiteboard, gesture: Gesture, at: Vec, event: { shiftKey: boolean }): void => {
  const writes: Partial<Record<Gesture['kind'], () => Element[]>> = {
    resize: () => (gesture.kind === 'resize' ? resized(gesture, pointToGrid(at, board.grid), event.shiftKey) : []),
    rotate: () => (gesture.kind === 'rotate' ? rotated(gesture, at, event.shiftKey) : []),
    create: () =>
      gesture.kind === 'create' ? [grown(board, gesture, at, event.shiftKey)].flatMap((each) => each ?? []) : []
  }
  if (gesture.kind === 'move') {
    followMove(board, gesture, at)
  } else if (gesture.kind === 'linear') {
    followLinear(board, gesture, at)
  } else if (gesture.kind === 'point') {
    followPoint(board, gesture, at)
  } else {
    const elements = writes[gesture.kind]?.() ?? []
    if (elements.length) {
      board.scene.put(...elements)
    }
  }
}

/** Erasing marks what the pointer passes over; the release removes it. */
export const erase = (board: Whiteboard, gesture: Extract<Gesture, { kind: 'erase' }>, at: Vec): void => {
  for (const element of board.hittable()) {
    if (!element.locked && hits(element, at, 6 / board.zoom)) {
      gesture.ids.add(element.id)
    }
  }
}

// ---------- Releasing ----------

/** A shape made with a click, not a drag, takes its default size around the click. */
const finishCreate = (board: Whiteboard, gesture: Extract<Gesture, { kind: 'create' }>, at: Vec): void => {
  const element = board.scene.get(gesture.id)
  if (!element) {
    return
  }
  if (hasPoints(element)) {
    board.scene.put(normalizePoints(element))
    return
  }
  if (Math.hypot(at.x - gesture.from.x, at.y - gesture.from.y) < CLICK) {
    const [width, height] = DEFAULT_SIZES[element.type as keyof typeof DEFAULT_SIZES] ?? [160, 100]
    board.scene.put({ ...element, x: at.x - width / 2, y: at.y - height / 2, width, height })
  }
  board.refitFrames([board.scene.get(gesture.id) ?? element])
}

const FINISH: Partial<Record<Gesture['kind'], (board: Whiteboard, gesture: Gesture, at: Vec) => void>> = {
  create: (board, gesture, at) => finishCreate(board, gesture as Extract<Gesture, { kind: 'create' }>, at),
  linear: (board, gesture, at) => finishLinear(board, gesture as LinearGesture, at),
  point: (board, gesture) => finishPoint(board, gesture as PointGesture),
  move: (board, gesture) => finishMove(board, gesture as MoveGesture),
  resize: (board) => board.refitFrames(board.selected()),
  erase: (board, gesture) => {
    const ids = (gesture as Extract<Gesture, { kind: 'erase' }>).ids
    if (ids.size) {
      board.scene.remove([...ids])
    }
  },
  marquee: (board, gesture) => {
    const area = gesture as Extract<Gesture, { kind: 'marquee' }>
    board.selectArea(area.from, area.to, area.additive)
  }
}

export const finish = (board: Whiteboard, gesture: Gesture, at: Vec): void => {
  FINISH[gesture.kind]?.(board, gesture, at)
  if ((gesture.kind === 'create' || gesture.kind === 'linear') && board.tool !== 'freedraw') {
    board.setTool('select')
  }
  board.guides = []
  board.scene.undo.stopCapturing()
}
