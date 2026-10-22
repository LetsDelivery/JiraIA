import * as Y from 'yjs'

/** How long local changes wait to go out together: a drag's steps in this window leave as one. */
export const BATCH_MS = 100

/**
 * Local changes to a Y.Doc, sent at most once per `BATCH_MS` (ADR-0009). What goes out is the doc's
 * own difference since the last send, not the updates one by one: the doc has already collected what
 * a drag overwrote, so the steps in between never reach the server, nor its stored state.
 */
export class UpdateBatcher {
  /** What the others already have: everything sent from here, and everything received. */
  private shared: Uint8Array
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly doc: Y.Doc,
    private readonly send: (update: Uint8Array) => void,
    private readonly canSend: () => boolean
  ) {
    this.shared = Y.encodeStateVector(doc)
  }

  /** A local change: it goes out with whatever else changes before the window closes. */
  changed(): void {
    this.dirty = true
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, BATCH_MS)
  }

  /** Sends what is waiting now, if the way out is open; otherwise it waits for the next flush. */
  flush(): void {
    if (!this.dirty || !this.canSend()) {
      return
    }
    const update = Y.encodeStateAsUpdate(this.doc, this.shared)
    this.shared = Y.encodeStateVector(this.doc)
    this.dirty = false
    this.send(update)
  }

  /**
   * Applies what came from the others. Local changes go out first, measured against what was shared
   * before, so what arrives is never sent back.
   */
  receive(apply: () => void): void {
    this.flush()
    apply()
    if (!this.dirty) {
      this.shared = Y.encodeStateVector(this.doc)
    }
  }

  destroy(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
