/**
 * A button while its action waits for the API: disabled, a spinner over its label, and `aria-busy`,
 * so a click never looks ignored. It comes back as it was whatever the answer; the caller still
 * handles a refusal.
 *
 * @example await busy(form.querySelector('button[type="submit"]'), () => drawWrite.rename(content, title))
 */
export const busy = async <T>(button: HTMLButtonElement | null | undefined, work: () => Promise<T>): Promise<T> => {
  if (!button) {
    return await work()
  }
  button.disabled = true
  button.setAttribute('aria-busy', 'true')
  try {
    return await work()
  } finally {
    button.disabled = false
    button.removeAttribute('aria-busy')
  }
}

/** The form's submit button — the one `busy` spins while the form is sent. */
export const submitButton = (form: Element | null | undefined): HTMLButtonElement | null =>
  form?.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])') ?? null
