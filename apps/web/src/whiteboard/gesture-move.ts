import { type Element, isLinear } from './elements'
import { contentsOf, isFrame } from './frames'
import { type Box, commonBounds, type Vec } from './geometry'
import { snapBox } from './snapping'
import type { Whiteboard } from './whiteboard'

/**
 * Moving the selection (Etapa 4d-b, ADR-0017): a frame takes what it holds; the moving box catches the
 * other elements' edges and centres, or the grid; an arrow moved without the shapes it is tied to lets
 * go of them.
 */
export type MoveGesture = { kind: 'move'; from: Vec; originals: Element[]; box: Box; others: Element[] }

export const startMove = (board: Whiteboard, at: Vec, selected: readonly Element[]): MoveGesture => {
  const frames = new Set(selected.filter(isFrame).map((frame) => frame.id))
  const ids = new Set(selected.map((element) => element.id))
  const held = contentsOf(frames, board.hittable()).filter((element) => !ids.has(element.id))
  const originals = [...selected, ...held]
  const moving = new Set(originals.map((element) => element.id))
  board.scene.undo.stopCapturing()
  return {
    kind: 'move',
    from: at,
    originals,
    box: commonBounds(selected),
    others: board.hittable().filter((element) => !moving.has(element.id) && !isLinear(element))
  }
}

export const followMove = (board: Whiteboard, gesture: MoveGesture, at: Vec): void => {
  const [dx, dy] = [at.x - gesture.from.x, at.y - gesture.from.y]
  const moved = { ...gesture.box, x: gesture.box.x + dx, y: gesture.box.y + dy }
  const snap = snapBox(moved, gesture.others, board.zoom, board.grid)
  board.guides = snap.guides
  const [sx, sy] = [dx + snap.dx, dy + snap.dy]
  board.scene.put(...gesture.originals.map((element) => ({ ...element, x: element.x + sx, y: element.y + sy })))
}

/** After a move: each element in the frame it now sits in, and arrows untied from shapes left behind. */
export const finishMove = (board: Whiteboard, gesture: MoveGesture): void => {
  const moved = new Set(gesture.originals.map((element) => element.id))
  board.refitFrames(gesture.originals.flatMap((element) => board.scene.get(element.id) ?? []))
  for (const arrow of gesture.originals.filter(isLinear)) {
    for (const end of ['startBinding', 'endBinding'] as const) {
      const tied = arrow[end]?.elementId
      if (tied && !moved.has(tied)) {
        board.scene.tie(arrow.id, end, null)
      }
    }
  }
}
