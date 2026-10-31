/**
 * A redraw must leave the reader where they were: each column's scroll, the comment being written,
 * and the field being typed in with its cursor — a quiet reload can land in the middle of a word.
 */
export const keepPlace = (dialog: HTMLDialogElement, redraw: () => void): void => {
  const columns = ['.detail-main', '.detail-side']
  const before = columns.map((selector) => dialog.querySelector(selector)?.scrollTop ?? 0)
  const typing = [dialog.querySelector<HTMLTextAreaElement>('#card-comment'), typedIn(dialog)]
    .filter((field) => field !== null && field.id !== '')
    .map((field) => ({
      id: field?.id ?? '',
      value: field?.value ?? '',
      focused: field === document.activeElement,
      at: field?.selectionStart ?? 0
    }))
  redraw()
  columns.forEach((selector, index) => {
    const column = dialog.querySelector(selector)
    if (column) {
      column.scrollTop = before[index] ?? 0
    }
  })
  for (const { id, value, focused, at } of typing) {
    restore(dialog.querySelector(`#${CSS.escape(id)}`), value, focused, at)
  }
}

/** Only free text keeps a cursor: a date or a number field has none to put back. */
const isText = (field: Element | null): field is HTMLInputElement | HTMLTextAreaElement =>
  field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type === 'text')

const typedIn = (dialog: HTMLDialogElement): HTMLInputElement | HTMLTextAreaElement | null => {
  const active = document.activeElement
  return dialog.contains(active) && isText(active) ? active : null
}

const restore = (field: Element | null, value: string, focused: boolean, at: number): void => {
  if (!isText(field)) {
    return
  }
  field.value = value
  if (focused) {
    field.focus()
    field.setSelectionRange(at, at)
  }
}
