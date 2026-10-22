import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { busy, submitButton } from '@/ui/busy'
import { bindDatePickers } from './date-picker'
import { icon } from './icons'
import { bindSelects } from './select'
import { toast } from './toast'

type EditorDialog = {
  title: string
  submit: string
  done: string
  /** Wider than a plain form: the editors lay rows out side by side. */
  className?: string
  /** The body, drawn again whenever `redraw` is called — the draft lives in the caller's closure. */
  body: () => Html
  /** Listeners on the body just drawn; `redraw` draws it again from the draft. */
  bind: (body: HTMLElement, redraw: () => void) => void
  onSubmit: () => Promise<unknown>
}

/**
 * A dialog whose content follows a draft: changing what kind of action a row is redraws the row with
 * the inputs that kind needs. The caller keeps the draft; the dialog only draws and submits it.
 */
export const openEditorDialog = (options: EditorDialog): void => {
  const dialog = document.createElement('dialog')
  dialog.className = `dialog glass editor-dialog ${options.className ?? ''}`
  dialog.setAttribute('aria-label', options.title)
  dialog.innerHTML = html`
    <form method="dialog" class="dialog-form">
      <header class="dialog-header">
        <h2>${options.title}</h2>
        <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="dialog-body editor-body" data-editor-body></div>
      <footer class="dialog-footer">
        <button type="button" class="button button-ghost" data-close>Cancelar</button>
        <button type="submit" class="button button-primary">${options.submit}</button>
      </footer>
    </form>
  `.value
  const body = dialog.querySelector('[data-editor-body]') as HTMLElement
  // A fresh container each time: listeners bound to the old one go with it instead of piling up.
  const redraw = () => {
    const content = document.createElement('div')
    content.className = 'editor-content'
    content.innerHTML = options.body().value
    body.replaceChildren(content)
    bindSelects(content)
    bindDatePickers(content)
    options.bind(content, redraw)
  }
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  for (const button of dialog.querySelectorAll('[data-close]')) {
    button.addEventListener('click', close)
  }
  dialog.addEventListener('cancel', close)
  dialog.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void _save(dialog, options, close)
  })
  document.body.append(dialog)
  redraw()
  dialog.showModal()
}

const _save = async (dialog: HTMLDialogElement, options: EditorDialog, close: () => void): Promise<void> => {
  try {
    await busy(submitButton(dialog.querySelector('form')), () => options.onSubmit())
    toast(options.done)
    close()
  } catch (refusal) {
    toast(refusalSentence(refusal), 'error')
  }
}
