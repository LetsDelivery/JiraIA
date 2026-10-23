/**
 * What a link in an e-mail asks of the card it opens (Etapa 5f): `#comentar` puts the cursor in the
 * comment box; `atribuir=eu` points at "Atribuir a mim". Nothing is saved by the link itself — the
 * person still clicks — and the address drops the request so a reload does not ask again.
 *
 * @example arrival(new URL('https://x/espacos/PRD?card=PRD-1&atribuir=eu'))   // { focus: 'assign', clean: '…?card=PRD-1' }
 */
export const arrival = (url: URL): { focus: 'comment' | 'assign' | null; clean: string } => {
  const clean = new URL(url)
  clean.hash = ''
  clean.searchParams.delete('atribuir')
  const focus = url.hash === '#comentar' ? 'comment' : url.searchParams.get('atribuir') === 'eu' ? 'assign' : null
  return { focus, clean: clean.toString() }
}

/** Does what the address asked, once, on the open card. */
export const applyArrival = (dialog: HTMLElement): void => {
  const { focus, clean } = arrival(new URL(location.href))
  if (!focus) {
    return
  }
  history.replaceState(null, '', clean)
  const target = dialog.querySelector<HTMLElement>(focus === 'comment' ? '#card-comment' : '[data-assign-me]')
  target?.classList.add('is-asked')
  target?.scrollIntoView({ block: 'center' })
  target?.focus()
}
