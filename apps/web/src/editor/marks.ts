import type { Editor } from '@tiptap/core'

/**
 * The comment marks in a page (escopo-mvp 5.7): put on the selected text when a thread starts, taken
 * off when it is resolved, and found again when someone opens the thread.
 */
export const markSelection = (editor: Editor, anchorId: string): string => {
  const { from, to } = editor.state.selection
  const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 1000)
  editor.chain().setMark('comment', { id: anchorId }).run()
  return quote
}

/** Every stretch carrying this thread's mark, as document ranges. */
const rangesOf = (editor: Editor, anchorId: string): { from: number; to: number }[] => {
  const ranges: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, position) => {
    if (node.marks.some((mark) => mark.type.name === 'comment' && mark.attrs.id === anchorId)) {
      ranges.push({ from: position, to: position + node.nodeSize })
    }
  })
  return ranges
}

export const unmarkComment = (editor: Editor, anchorId: string): void => {
  const type = editor.schema.marks.comment
  if (!type) {
    return
  }
  const transaction = editor.state.tr
  for (const range of rangesOf(editor, anchorId)) {
    transaction.removeMark(range.from, range.to, type)
  }
  editor.view.dispatch(transaction)
}

/** Brings the thread's text into view and selects it; `false` when it is no longer in the page. */
export const revealComment = (editor: Editor, anchorId: string): boolean => {
  const [first] = rangesOf(editor, anchorId)
  if (!first) {
    return false
  }
  editor.chain().focus().setTextSelection(first).scrollIntoView().run()
  return true
}

/** The thread whose mark is under the cursor, if any — clicking marked text opens it. */
export const commentAt = (editor: Editor): string | undefined =>
  editor.state.selection.$from.marks().find((mark) => mark.type.name === 'comment')?.attrs.id as string | undefined
