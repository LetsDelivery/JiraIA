/**
 * Whether someone is at the panel (ADR-0035). Only then does it ask the API on its own — the bell, a
 * page's socket coming back — so a tab left open overnight lets the database pause; the first touch
 * after that brings everything up to date.
 */

/** With no key, pointer, scroll or touch for this long, the person has stepped away. */
export const AWAY_MS = 10 * 60_000

const SIGNS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

export class Presence {
  private lastSeen: number
  private readonly returns = new Set<() => void>()

  constructor(
    private readonly visible: () => boolean,
    private readonly now: () => number = Date.now
  ) {
    this.lastSeen = now()
  }

  /** At the panel: the tab is in view and was touched within `AWAY_MS`. */
  isHere(): boolean {
    return this.visible() && this.now() - this.lastSeen < AWAY_MS
  }

  /** A sign of the person; with the tab in view, whoever waits for their return is told. */
  seen(): void {
    this.lastSeen = this.now()
    if (this.returns.size === 0 || !this.visible()) {
      return
    }
    const waiting = [...this.returns]
    this.returns.clear()
    for (const run of waiting) {
      run()
    }
  }

  /** `run` once, at the next sign of the person with the tab in view. */
  onReturn(run: () => void): void {
    this.returns.add(run)
  }
}

/** The panel's one presence, fed by the window's own events. */
export const presence = new Presence(() => document.visibilityState === 'visible')

export const watchPresence = (): void => {
  for (const sign of SIGNS) {
    window.addEventListener(sign, () => presence.seen(), { passive: true })
  }
  document.addEventListener('visibilitychange', () => presence.seen())
}
