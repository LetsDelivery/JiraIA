import type { Database } from '@jiraia/db'

/**
 * Whether this invocation committed anything (ADR-0035). Every write records an audit event in its
 * transaction (ADR-0004), so a commit means the outbox may hold something: the invocation ends by
 * waking the dispatch, whose pass plans every other job.
 */
export class CommitSignal {
  private committed = false

  mark(): void {
    this.committed = true
  }

  /** Whether a transaction committed since the last time it was taken; taking it clears it. */
  take(): boolean {
    const was = this.committed
    this.committed = false
    return was
  }
}

/**
 * The same database, its top-level transactions marking `signal` once they commit. A proxy rather
 * than an assignment, so a database handed in by a suite is left as it was.
 */
export const signalCommits = (db: Database, signal: CommitSignal): Database => {
  const transaction = db.transaction.bind(db)
  const signalled = (async (...args: Parameters<Database['transaction']>) => {
    const result = await transaction(...args)
    signal.mark()
    return result
  }) as Database['transaction']
  return new Proxy(db, {
    get: (target, key, receiver) => (key === 'transaction' ? signalled : Reflect.get(target, key, receiver))
  })
}
