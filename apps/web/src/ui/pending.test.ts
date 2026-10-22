import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { busy } from './busy'
import { holdPlace, markCurrent, SHOW_AFTER_MS, SHOW_FOR_MS } from './pending'
import { skeleton } from './skeleton'

/** The few attributes the helpers touch, kept in a map as a DOM element would. */
const element = (extra: Record<string, unknown> = {}) => {
  const attributes = new Map<string, string>()
  return {
    attributes,
    disabled: false,
    isConnected: true,
    innerHTML: 'the old screen',
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    ...extra
  }
}

describe('busy', () => {
  it('disables and spins the button while the action waits, and restores it after', async () => {
    const button = element()
    let during: unknown[] = []
    await busy(button as unknown as HTMLButtonElement, async () => {
      during = [button.disabled, button.attributes.get('aria-busy')]
    })
    expect(during).toEqual([true, 'true'])
    expect([button.disabled, button.attributes.has('aria-busy')]).toEqual([false, false])
  })

  it('restores the button when the API refuses, and passes the refusal on', async () => {
    const button = element()
    const refused = busy(button as unknown as HTMLButtonElement, () => Promise.reject(new Error('Refused')))
    await expect(refused).rejects.toThrow('Refused')
    expect([button.disabled, button.attributes.has('aria-busy')]).toEqual([false, false])
  })

  it('still runs the action when there is no button', async () => {
    await expect(busy(null, async () => 'done')).resolves.toBe('done')
  })
})

describe('holdPlace', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('leaves a quick screen alone: no skeleton, no wait', async () => {
    const host = element()
    const placeholder = holdPlace(host as unknown as HTMLElement, 'list', () => true)
    vi.advanceTimersByTime(SHOW_AFTER_MS - 1)
    await placeholder.settle()
    expect(host.innerHTML).toBe('the old screen')
  })

  it('shows the skeleton of a slow screen and keeps it up long enough not to flash', async () => {
    const host = element()
    const placeholder = holdPlace(host as unknown as HTMLElement, 'board', () => true)
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    expect(host.innerHTML).toContain('skeleton-board')
    expect(host.attributes.get('aria-busy')).toBe('true')
    let settled = false
    void placeholder.settle().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(SHOW_FOR_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })

  it('draws nothing for a render another navigation overtook', () => {
    const host = element()
    holdPlace(host as unknown as HTMLElement, 'list', () => false)
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    expect(host.innerHTML).toBe('the old screen')
  })
})

describe('markCurrent', () => {
  const link = (href: string, kind: string) => {
    const classes = new Set<string>()
    const item = element({
      getAttribute: () => href,
      closest: () => null,
      matches: (selector: string) => selector.includes(kind),
      classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) }
    })
    return Object.assign(item, { classes })
  }

  it('marks the clicked menu item at once and unmarks the one that was current', () => {
    const before = link('/espacos', '.nav-item')
    const clicked = link('/pessoas', '.nav-item')
    before.classes.add('is-active')
    before.attributes.set('aria-current', 'page')
    markCurrent({ querySelectorAll: () => [before, clicked] } as unknown as HTMLElement, '/pessoas')
    expect([clicked.attributes.get('aria-current'), clicked.classes.has('is-active')]).toEqual(['page', true])
    expect([before.attributes.has('aria-current'), before.classes.has('is-active')]).toEqual([false, false])
  })
})

describe('skeleton', () => {
  it('tells assistive tech the screen is loading, in every shape', () => {
    for (const kind of ['list', 'board', 'table', 'document'] as const) {
      const markup = skeleton(kind).value
      expect(markup).toContain(`skeleton-${kind}`)
      expect(markup).toContain('role="status"')
      expect(markup).toContain('Carregando…')
    }
  })
})
