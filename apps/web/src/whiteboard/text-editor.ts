import { isText, type TextElement } from './elements'
import { FONT_STACK } from './text-layout'
import type { Whiteboard } from './whiteboard'

/**
 * Writing on the board (ADR-0017): a textarea over the text, the same font, size and turn, so what is
 * typed looks as it will once drawn. Each keystroke is written to the document, so the others see the
 * words arrive and a shape grows to hold them. Leaving the box with nothing in it removes the text.
 */
const place = (editor: HTMLTextAreaElement, board: Whiteboard, text: TextElement): void => {
  const { x, y, zoom } = board.view
  Object.assign(editor.style, {
    left: `${x + text.x * zoom}px`,
    top: `${y + text.y * zoom}px`,
    width: `${Math.max(text.width, text.fontSize) * zoom + 4}px`,
    height: `${text.height * zoom + 4}px`,
    fontSize: `${text.fontSize * zoom}px`,
    fontFamily: FONT_STACK[text.fontFamily],
    lineHeight: String(text.lineHeight),
    textAlign: text.textAlign,
    color: text.strokeColor,
    transform: text.angle ? `rotate(${text.angle}rad)` : '',
    whiteSpace: text.autoResize && !text.containerId ? 'pre' : 'pre-wrap'
  })
}

export const editText = (board: Whiteboard, textId: string): void => {
  const initial = board.scene.get(textId)
  if (!initial || !isText(initial)) {
    return
  }
  const editor = document.createElement('textarea')
  editor.className = 'wb-text-editor'
  editor.value = initial.text
  editor.setAttribute('aria-label', 'Texto')
  editor.spellcheck = true
  board.editing = textId
  board.redraw()
  place(editor, board, initial)

  editor.addEventListener('input', () => {
    const current = board.scene.get(textId)
    if (current && isText(current)) {
      board.scene.put({ ...current, text: editor.value })
      const laid = board.scene.get(textId)
      if (laid && isText(laid)) {
        place(editor, board, laid)
      }
    }
  })
  editor.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      editor.blur()
    }
  })
  editor.addEventListener('blur', () => finish(board, editor, textId))
  board.root.append(editor)
  editor.focus()
  editor.select()
}

const finish = (board: Whiteboard, editor: HTMLTextAreaElement, textId: string): void => {
  editor.remove()
  board.editing = null
  const text = board.scene.get(textId)
  if (text && isText(text) && !text.text.trim()) {
    board.scene.remove([textId])
    board.select(text.containerId ? [text.containerId] : [])
  }
  board.redraw()
  board.focus()
}
