/**
 * The database paused while nobody used it (ADR-0035) takes some seconds to resume. The panel starts
 * that early: at the first sign of the person after a quiet spell — the mouse moving, a key, the tab
 * coming back — it sends one quiet request, so the resume runs while they decide where to click.
 */

/** A tab silent this long may have let the database pause (it pauses after five idle minutes). */
export const QUIET_MS = 4 * 60_000

export class Warmer {
  private lastHeard: number

  /** `ping` is one cheap authenticated request; its answer and its failure are both ignored. */
  constructor(
    private readonly ping: () => Promise<unknown>,
    private readonly now: () => number = Date.now
  ) {
    this.lastHeard = now()
  }

  /** The API answered: the database is awake now. */
  heard(): void {
    this.lastHeard = this.now()
  }

  /** A sign of the person: after a quiet spell, one ping sets the database resuming. */
  nudge(): void {
    if (this.now() - this.lastHeard < QUIET_MS) {
      return
    }
    this.lastHeard = this.now()
    void this.ping().catch(() => undefined)
  }
}
