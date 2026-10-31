/** How long a read begun ahead stays good enough to show: after that, the click asks again. */
export const PREFETCH_MS = 15_000

/**
 * Reads begun before the person asks for them — the pointer resting on a card — so the click finds
 * the answer on its way. Each one is taken once; a write anywhere clears them all.
 */
export class Prefetcher<T> {
  private readonly started = new Map<string, { at: number; value: Promise<T> }>()

  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly now: () => number = Date.now
  ) {}

  /** Starts the read unless a fresh one is already under way; its failure waits for `take`. */
  warm(key: string): void {
    if (this._fresh(key)) {
      return
    }
    const value = this.load(key)
    value.catch(() => undefined)
    this.started.set(key, { at: this.now(), value })
  }

  /** The read begun ahead if it is still fresh, else a new one. Either way it is not kept. */
  take(key: string): Promise<T> {
    const entry = this._fresh(key)
    this.started.delete(key)
    return entry ? entry.value : this.load(key)
  }

  clear(): void {
    this.started.clear()
  }

  private _fresh(key: string) {
    const entry = this.started.get(key)
    return entry && this.now() - entry.at < PREFETCH_MS ? entry : undefined
  }
}
