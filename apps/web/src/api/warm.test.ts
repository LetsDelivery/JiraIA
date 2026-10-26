import { describe, expect, it, vi } from 'vitest'

import { QUIET_MS, Warmer } from './warm'

/** A warmer on a clock the test moves, counting its pings. */
const at = () => {
  const state = { now: 0 }
  const ping = vi.fn(async () => undefined)
  return { state, ping, warmer: new Warmer(ping, () => state.now) }
}

describe('Warmer', () => {
  it('pings nothing while the panel talks to the API (ADR-0035)', () => {
    const { state, ping, warmer } = at()
    warmer.nudge()
    state.now = QUIET_MS - 1
    warmer.nudge()
    state.now = QUIET_MS + 1000
    warmer.heard()
    warmer.nudge()
    expect(ping).not.toHaveBeenCalled()
  })

  it('pings once at the first sign after a quiet spell, not at every mouse move', () => {
    const { state, ping, warmer } = at()
    state.now = QUIET_MS
    warmer.nudge()
    warmer.nudge()
    state.now += 1000
    warmer.nudge()
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('ignores a ping that fails: the database is resuming either way', async () => {
    const state = { now: QUIET_MS }
    const warmer = new Warmer(
      () => Promise.reject(new Error('503')),
      () => state.now
    )
    expect(() => warmer.nudge()).not.toThrow()
    await Promise.resolve()
  })
})
