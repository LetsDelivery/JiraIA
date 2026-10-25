import { describe, expect, it, vi } from 'vitest'

import { AWAY_MS, Presence } from './presence'

/** A presence on a clock and a tab whose visibility the test sets. */
const at = () => {
  const state = { now: 0, visible: true }
  return {
    state,
    presence: new Presence(
      () => state.visible,
      () => state.now
    )
  }
}

describe('Presence', () => {
  it('is here while the tab is seen and was touched within AWAY_MS (ADR-0035)', () => {
    const { state, presence } = at()
    expect(presence.isHere()).toBe(true)
    state.now = AWAY_MS
    expect(presence.isHere()).toBe(false)
    presence.seen()
    expect(presence.isHere()).toBe(true)
    state.visible = false
    expect(presence.isHere()).toBe(false)
  })

  it('tells who waits, once, at the first sign with the tab in view', () => {
    const { state, presence } = at()
    const reconnect = vi.fn()
    presence.onReturn(reconnect)
    presence.onReturn(reconnect)
    state.visible = false
    presence.seen()
    expect(reconnect).not.toHaveBeenCalled()
    state.visible = true
    presence.seen()
    presence.seen()
    expect(reconnect).toHaveBeenCalledTimes(1)
  })
})
