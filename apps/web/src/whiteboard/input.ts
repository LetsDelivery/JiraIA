import { refusalSentence } from '@/lib/refusal'
import { toast } from '@/ui/toast'

import { paste, serialize } from './clipboard'
import { removeSelected } from './commands'
import { type Element, isText, newText } from './elements'
import type { Box, Handle, Vec } from './geometry'
import { removePoint, startPoint } from './gesture-linear'
import { erase, finish, follow, type Gesture, startCreate, startResize, startRotate, startTransform } from './gestures'
import { insertImages } from './images'
import { onKey } from './keyboard'
import { editText } from './text-editor'
import type { Whiteboard } from './whiteboard'

/**
 * The whiteboard's input (ADR-0017): what a press starts, what a drag does, a double press, the wheel,
 * the keys, and the clipboard. The board keeps the state; this decides what each event means.
 */
type Target = globalThis.Element

let lastPress = { at: 0, x: 0, y: 0 }
/** The second press of a possible double click: it counts only if it is released where it was pressed. */
let secondPress: { x: number; y: number } | undefined

/**
 * A second press soon after the first, in the same place. Counted here, not by `dblclick`: the scene is
 * drawn again between the two presses, and the browser does not pair clicks on different nodes.
 */
const noteDoublePress = (board: Whiteboard, event: PointerEvent): void => {
  const double =
    event.timeStamp - lastPress.at < 400 && Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) < 6
  lastPress = double ? { at: 0, x: 0, y: 0 } : { at: event.timeStamp, x: event.clientX, y: event.clientY }
  secondPress =
    double && event.button === 0 && board.tool === 'select' ? { x: event.clientX, y: event.clientY } : undefined
}

/** A press then a drag is a drag, however quick: a double click is two presses that do not move. */
const isDoubleClick = (event: PointerEvent): boolean =>
  secondPress !== undefined && Math.hypot(event.clientX - secondPress.x, event.clientY - secondPress.y) < 4

// ---------- Texts ----------

const makeText = (board: Whiteboard, box: Box, containerId: string | null) => {
  const textStyle = containerId
    ? board.textStyle
    : { ...board.textStyle, textAlign: 'left' as const, verticalAlign: 'top' as const }
  return newText(box, { ...board.style, strokeColor: board.textColor }, textStyle, board.scene.top, containerId)
}

/** Text inside a shape or on an arrow: the one it has, or a new one. Enter does the same. */
export const editInside = (board: Whiteboard, container: Element): void => {
  if (!['rectangle', 'ellipse', 'diamond', 'arrow'].includes(container.type) || container.locked) {
    return
  }
  const existing = container.boundElements.find((bound) => bound.type === 'text')
  if (existing) {
    editText(board, existing.id)
    return
  }
  const text = { ...makeText(board, container, container.id), frameId: container.frameId }
  board.scene.put({ ...container, boundElements: [...container.boundElements, { id: text.id, type: 'text' }] }, text)
  editText(board, text.id)
}

const newFreeText = (board: Whiteboard, at: Vec): void => {
  const text = makeText(board, { x: at.x, y: at.y - board.textStyle.fontSize / 2, width: 0, height: 0 }, null)
  board.scene.put(text)
  board.setTool('select')
  board.select([text.id])
  editText(board, text.id)
}

/** On a line's middle point: removes it. On a text: edits it. On a shape: its text. On nothing: a new text. */
const onDoublePress = (board: Whiteboard, event: PointerEvent): void => {
  const point = (event.target as Target).closest?.('[data-point]')?.getAttribute('data-point')
  const [only] = board.selected()
  const at = board.toBoard(event)
  const target = board.elementAt(at)
  if (!board.editable) {
    return
  }
  if (point && only) {
    removePoint(board, only.id, Number(point))
  } else if (!target) {
    newFreeText(board, at)
  } else if (isText(target)) {
    editText(board, target.id)
  } else {
    editInside(board, target)
  }
}

// ---------- Pressing ----------

/** A press on a line's point grabs the point; on the dot between two, it adds one. */
const startOnPoints = (board: Whiteboard, target: Target): Gesture | undefined => {
  const [only] = board.selected()
  const point = target.closest?.('[data-point]')?.getAttribute('data-point')
  const middle = target.closest?.('[data-midpoint]')?.getAttribute('data-midpoint')
  const index = point ?? middle
  return only && index != null ? startPoint(board, only.id, Number(index), point == null) : undefined
}

const startSelecting = (board: Whiteboard, event: PointerEvent, at: Vec): Gesture => {
  const target = board.elementAt(at)
  if (!target) {
    return { kind: 'marquee', from: at, to: at, additive: event.shiftKey ? board.selection : [] }
  }
  if (event.shiftKey) {
    const toggled = board.selection.includes(target.id)
      ? board.selection.filter((id) => id !== target.id)
      : [...board.selection, target.id]
    board.select(toggled)
    return { kind: 'marquee', from: at, to: at, additive: toggled }
  }
  if (!board.selection.includes(target.id)) {
    board.select([target.id])
  }
  return board.editable
    ? startTransform(board, at, target)
    : { kind: 'marquee', from: at, to: at, additive: [target.id] }
}

const startWithTool = (board: Whiteboard, event: PointerEvent, at: Vec): Gesture | undefined => {
  if (board.tool === 'eraser') {
    const gesture: Gesture = { kind: 'erase', ids: new Set() }
    erase(board, gesture, at)
    return gesture
  }
  if (board.tool === 'text') {
    newFreeText(board, at)
    return undefined
  }
  return board.tool === 'select' ? startSelecting(board, event, at) : startCreate(board, at)
}

/** What a press starts, by the button, the keys held, the tool and what is under the pointer. */
const start = (board: Whiteboard, event: PointerEvent): Gesture | undefined => {
  const at = board.toBoard(event)
  if (event.button === 1 || board.spaceHeld || board.tool === 'hand') {
    return { kind: 'pan', from: { x: event.clientX, y: event.clientY }, view: { x: board.view.x, y: board.view.y } }
  }
  const target = event.target as Target
  if (board.editable && target.closest?.('[data-rotate]')) {
    return startRotate(board, at)
  }
  const handle = target.closest?.('[data-handle]')?.getAttribute('data-handle')
  if (board.editable && handle) {
    return startResize(board, at, handle as Handle)
  }
  return (board.editable ? startOnPoints(board, target) : undefined) ?? startWithTool(board, event, at)
}

// ---------- Moving and releasing ----------

const onMove = (board: Whiteboard, event: PointerEvent): void => {
  const at = board.toBoard(event)
  board.awareness.setLocalStateField('pointer', at)
  const gesture = board.gesture
  if (gesture?.kind === 'pan') {
    board.view = {
      ...board.view,
      x: gesture.view.x + event.clientX - gesture.from.x,
      y: gesture.view.y + event.clientY - gesture.from.y
    }
  } else if (gesture?.kind === 'marquee') {
    gesture.to = at
  } else if (gesture?.kind === 'erase') {
    erase(board, gesture, at)
  } else if (gesture && board.editable) {
    follow(board, gesture, at, event)
  }
  board.redraw()
}

const onUp = (board: Whiteboard, event: PointerEvent): void => {
  const gesture = board.gesture
  board.gesture = undefined
  if (gesture && gesture.kind !== 'pan') {
    finish(board, gesture, board.toBoard(event))
  }
  board.redraw()
  board.changed()
}

const onWheel = (board: Whiteboard, event: WheelEvent): void => {
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) {
    board.zoomBy(Math.exp(-event.deltaY * 0.01), event)
    return
  }
  board.panBy(-event.deltaX, -event.deltaY)
}

// ---------- Clipboard ----------

let pointer: Vec = { x: 0, y: 0 }

/** Images pasted land as images; anything else as elements or text. Says whether something was pasted. */
const pasteFrom = (board: Whiteboard, data: DataTransfer | null): boolean => {
  const images = [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'))
  const text = data?.getData('text/plain') ?? ''
  if (images.length) {
    void insertImages(board, images, pointer).catch(refuse)
  } else if (text) {
    paste(board, text, pointer)
  }
  return images.length > 0 || text.length > 0
}

/** Copy, cut and paste reach the board while it has the focus, through the system clipboard. */
const bindClipboard = (board: Whiteboard): void => {
  const focused = () => document.activeElement === board.svg
  const options = { signal: board.lifetime.signal }
  document.addEventListener(
    'copy',
    (event) => {
      if (focused() && board.selection.length) {
        event.clipboardData?.setData('text/plain', serialize(board))
        event.preventDefault()
      }
    },
    options
  )
  document.addEventListener(
    'cut',
    (event) => {
      if (focused() && board.selection.length && board.editable) {
        event.clipboardData?.setData('text/plain', serialize(board))
        event.preventDefault()
        removeSelected(board)
      }
    },
    options
  )
  document.addEventListener(
    'paste',
    (event) => {
      if (focused() && board.editable && pasteFrom(board, event.clipboardData)) {
        event.preventDefault()
      }
    },
    options
  )
}

const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')

/** Image files dropped on the board land where they were dropped. */
const bindDrop = (board: Whiteboard): void => {
  board.svg.addEventListener('dragover', (event) => {
    if (board.editable && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
    }
  })
  board.svg.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (board.editable && files.length) {
      event.preventDefault()
      void insertImages(board, files, board.toBoard(event)).catch(refuse)
    }
  })
}

export const bindInput = (board: Whiteboard): void => {
  const svg = board.svg
  bindDrop(board)
  svg.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    board.focus()
    noteDoublePress(board, event)
    svg.setPointerCapture(event.pointerId)
    board.altHeld = event.altKey
    board.gesture = start(board, event)
    board.redraw()
  })
  svg.addEventListener('pointermove', (event) => {
    pointer = board.toBoard(event)
    board.altHeld = event.altKey
    onMove(board, event)
  })
  svg.addEventListener('pointerup', (event) => {
    board.altHeld = event.altKey
    onUp(board, event)
    if (isDoubleClick(event)) {
      onDoublePress(board, event)
    }
    secondPress = undefined
  })
  svg.addEventListener('wheel', (event) => onWheel(board, event), { passive: false })
  svg.addEventListener('keydown', (event) => onKey(board, event))
  svg.addEventListener('keyup', (event) => {
    if (event.key === ' ') {
      board.spaceHeld = false
      board.root.classList.remove('is-panning')
    }
  })
  svg.addEventListener('pointerleave', () => board.awareness.setLocalStateField('pointer', null))
  bindClipboard(board)
}
