import type { Clock } from '@jiraia/core'

import type { JobName } from '../lambda/jobs.js'

/**
 * A job to run at a time (ADR-0035). `retry` counts the passes in a row that left the job still due,
 * so a job that keeps failing backs off instead of keeping the database awake.
 */
export type Wake = { job: JobName; at: Date; retry: number }

/**
 * How a job is reached: the jobs queue for now, a one-time schedule for later. The AWS SDKs are behind
 * it (`aws-transport.ts`); the local harness runs the job in its own process.
 */
export type WakeTransport = {
  now(wake: Wake): Promise<void>
  later(wake: Wake): Promise<void>
}

const MINUTE_MS = 60_000
/** A one-time schedule is set at least this far ahead, so it is never in the past when it lands. */
const LEAD_MS = 10_000

/** `at` moved forward to the next whole minute, the finest a one-time schedule keeps. */
export const nextMinute = (at: Date): Date => new Date(Math.ceil(at.getTime() / MINUTE_MS) * MINUTE_MS)

/** The earliest wake of each job: a later one would only find the work already done. */
export const earliest = (wakes: readonly Wake[]): Wake[] => {
  const byJob = new Map<JobName, Wake>()
  for (const wake of wakes) {
    const kept = byJob.get(wake.job)
    if (!kept || wake.at.getTime() < kept.at.getTime()) {
      byJob.set(wake.job, wake)
    }
  }
  return [...byJob.values()]
}

/**
 * Sends each job its wake: one due now goes on the queue, one due later becomes a one-time schedule at
 * the minute it falls in. Nothing runs on a clock of its own, so a database with no work is left to
 * pause (ADR-0035).
 */
export class Waker {
  constructor(private readonly deps: { clock: Clock; transport: WakeTransport }) {}

  async wake(wakes: readonly Wake[]): Promise<void> {
    const now = this.deps.clock.now().getTime()
    for (const wake of earliest(wakes)) {
      if (wake.at.getTime() <= now) {
        await this.deps.transport.now(wake)
      } else {
        const at = nextMinute(new Date(Math.max(wake.at.getTime(), now + LEAD_MS)))
        await this.deps.transport.later({ ...wake, at })
      }
    }
  }
}

/** Where nothing is configured to reach the jobs — the suites — the wakes are kept to be read. */
export class HeldWakes implements WakeTransport {
  readonly held: Wake[] = []

  async now(wake: Wake): Promise<void> {
    this.held.push(wake)
  }

  async later(wake: Wake): Promise<void> {
    this.held.push(wake)
  }
}
