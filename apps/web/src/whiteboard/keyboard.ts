import { duplicateSelected, nudge, redo, removeSelected, selectAll, undo } from './commands'
import { editInside } from './input'
import { bringForward, bringToFront, group, sendBackward, sendToBack, ungroup } from './organize'
import type { Tool, Whiteboard } from './whiteboard'

/**
 * The whiteboard's keys (ADR-0017): a letter or a number per tool, as in most whiteboards, and the
 * usual shortcuts. ⌘ on a Mac, Ctrl elsewhere.
 */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  '1': 'select',
  h: 'hand',
  r: 'rectangle',
  '2': 'rectangle',
  d: 'diamond',
  '3': 'diamond',
  o: 'ellipse',
  '4': 'ellipse',
  a: 'arrow',
  '5': 'arrow',
  l: 'line',
  '6': 'line',
  p: 'freedraw',
  '7': 'freedraw',
  t: 'text',
  '8': 'text',
  '9': 'image',
  i: 'image',
  e: 'eraser',
  '0': 'eraser',
  f: 'frame'
}

type Keys = Record<string, (board: Whiteboard) => void>

/** With ⌘ or Ctrl. */
const COMMAND: Keys = {
  s: (board) => board.onSave(),
  g: (board) => group(board),
  ']': (board) => bringForward(board),
  '[': (board) => sendBackward(board),
  "'": (board) => board.toggleGrid(),
  z: (board) => undo(board),
  y: (board) => redo(board),
  d: (board) => duplicateSelected(board),
  a: (board) => selectAll(board),
  '=': (board) => board.zoomBy(1.2),
  '+': (board) => board.zoomBy(1.2),
  '-': (board) => board.zoomBy(1 / 1.2),
  '0': (board) => board.zoomTo(1)
}

/** With ⌘ or Ctrl and Shift, by the key's place: redo, ungroup, and the front and the back. */
const SHIFTED_COMMAND: Keys = {
  KeyZ: (board) => redo(board),
  KeyG: (board) => ungroup(board),
  BracketRight: (board) => bringToFront(board),
  BracketLeft: (board) => sendToBack(board)
}

/** With Shift, by the key's place, so it works on any layout: Shift+1 fits all, Shift+2 the selection. */
const SHIFTED: Keys = {
  Digit1: (board) => board.fit(),
  Digit2: (board) => board.fit(board.selected().length ? board.selected() : undefined)
}

const STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const

const PLAIN: Keys = {
  Delete: (board) => removeSelected(board),
  Backspace: (board) => removeSelected(board),
  Escape: (board) => {
    board.select([])
    board.setTool('select')
  },
  Enter: (board) => {
    const [only] = board.selected()
    if (only && board.selection.length === 1) {
      editInside(board, only)
    }
  }
}

const command = (board: Whiteboard, event: KeyboardEvent): (() => void) | undefined => {
  const key = event.key.toLowerCase()
  const shifted = SHIFTED_COMMAND[event.code]
  if (event.shiftKey && shifted) {
    return () => shifted(board)
  }
  const action = COMMAND[key]
  return action ? () => action(board) : undefined
}

const plain = (board: Whiteboard, event: KeyboardEvent): (() => void) | undefined => {
  const step = STEP[event.key as keyof typeof STEP]
  if (step) {
    const size = event.shiftKey ? 10 : 1
    return () => nudge(board, step[0] * size, step[1] * size)
  }
  const shifted = event.shiftKey ? SHIFTED[event.code] : undefined
  const action = shifted ?? PLAIN[event.key]
  if (action) {
    return () => action(board)
  }
  const tool = TOOL_KEYS[event.key.toLowerCase()]
  return tool && !event.shiftKey && !event.altKey ? () => board.setTool(tool) : undefined
}

export const onKey = (board: Whiteboard, event: KeyboardEvent): void => {
  if (event.key === ' ' && !board.spaceHeld) {
    board.spaceHeld = true
    board.root.classList.add('is-panning')
    event.preventDefault()
    return
  }
  const action = event.metaKey || event.ctrlKey ? command(board, event) : plain(board, event)
  if (action) {
    event.preventDefault()
    action()
  }
}
