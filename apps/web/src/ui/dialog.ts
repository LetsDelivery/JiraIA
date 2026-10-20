import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'

import { icon } from './icons'
import { bindSelects } from './select'
import { toast } from './toast'

type FormDialog = {
  title: string
  submit: string
  done: string
  fields: Html
  /** Resolves when saved. A rejection is shown as a toast and keeps the dialog open. */
  onSubmit: (data: FormData) => Promise<unknown>
  /** Listeners the fields need beyond the form itself, attached once the dialog is open. */
  onOpen?: (dialog: HTMLDialogElement) => void
}

/**
 * A form in a native `<dialog>`: focus trapping, Escape and the backdrop come from the browser.
 * The surface is glass (ADR-0006): it floats over the page it belongs to.
 */
export const openFormDialog = (options: FormDialog): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass'
  dialog.setAttribute('aria-label', options.title)
  dialog.innerHTML = html`
    <form method="dialog" class="dialog-form">
      <header class="dialog-header">
        <h2>${options.title}</h2>
        <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="dialog-body">${options.fields}</div>
      <footer class="dialog-footer">
        <button type="submit" class="button button-primary">${options.submit}</button>
      </footer>
    </form>
  `.value

  const form = dialog.querySelector('form') as HTMLFormElement
  const close = () => {
    dialog.close()
    dialog.remove()
  }

  dialog.querySelector('[data-close]')?.addEventListener('click', close)
  dialog.addEventListener('cancel', close)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void _save(form, options, close)
  })

  document.body.append(dialog)
  bindSelects(dialog)
  dialog.showModal()
  options.onOpen?.(dialog)
}

/** A dialog that only tells something — no form, one way out. */
export const openNotice = (title: string, body: Html): void => {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog glass'
  dialog.setAttribute('aria-label', title)
  dialog.innerHTML = html`
    <header class="dialog-header">
      <h2>${title}</h2>
      <button type="button" class="button button-ghost button-icon" data-close aria-label="Fechar">${icon('x')}</button>
    </header>
    <div class="dialog-body">${body}</div>
  `.value
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  dialog.querySelector('[data-close]')?.addEventListener('click', close)
  dialog.addEventListener('cancel', close)
  document.body.append(dialog)
  dialog.showModal()
}

const _save = async (form: HTMLFormElement, options: FormDialog, close: () => void): Promise<void> => {
  const button = form.querySelector('button[type="submit"]') as HTMLButtonElement
  button.disabled = true
  try {
    await options.onSubmit(new FormData(form))
    toast(options.done)
    close()
  } catch (refusal) {
    toast(refusalSentence(refusal), 'error')
  } finally {
    button.disabled = false
  }
}

/** A labelled text field. `id` ties the label to the input, which is what assistive tech reads. */
export const textField = (options: {
  name: string
  label: string
  hint?: string
  type?: string
  required?: boolean
  placeholder?: string
  maxLength?: number
  value?: string
}): Html => {
  const id = `field-${options.name}`

  return html`
    <div class="field">
      <label for="${id}">${options.label}</label>
      <input
        id="${id}"
        name="${options.name}"
        type="${options.type ?? 'text'}"
        class="input"
        ${options.required ? html`required` : ''}
        ${options.placeholder ? html`placeholder="${options.placeholder}"` : ''}
        ${options.maxLength ? html`maxlength="${options.maxLength}"` : ''}
        ${options.value === undefined ? '' : html`value="${options.value}"`}
      />
      ${options.hint ? html`<p class="field-hint">${options.hint}</p>` : ''}
    </div>
  `
}
