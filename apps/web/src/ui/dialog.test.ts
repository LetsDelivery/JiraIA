import { describe, expect, it, vi } from 'vitest'

import { closeOnEscape } from './dialog'

describe('closeOnEscape', () => {
  const dialogWithListener = () => {
    let listener: (event: Event) => void = () => undefined
    const dialog = { addEventListener: (_: string, handler: (event: Event) => void) => (listener = handler) }
    return { dialog: dialog as unknown as HTMLDialogElement, fire: (target: unknown) => listener({ target } as Event) }
  }

  it('closes on the dialog’s own cancel — Escape', () => {
    const { dialog, fire } = dialogWithListener()
    const close = vi.fn()
    closeOnEscape(dialog, close)
    fire(dialog)
    expect(close).toHaveBeenCalledOnce()
  })

  it('stays open when a file picker inside it is cancelled', () => {
    const { dialog, fire } = dialogWithListener()
    const close = vi.fn()
    closeOnEscape(dialog, close)
    fire({ type: 'file' })
    expect(close).not.toHaveBeenCalled()
  })
})
