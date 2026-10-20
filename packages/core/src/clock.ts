/**
 * Time, behind a port.
 *
 * Nothing in the platform calls `new Date()` or `Date.now()` directly. Sort keys are
 * built from timestamps (`ENTRY#<iso>#<id>`), rate-limit windows are compared against
 * them, and a test that cannot control time either sleeps or is flaky — the project's
 * tests are required to be fast and repeatable, so neither is acceptable.
 */
export type Clock = { now: () => Date }

export const systemClock: Clock = { now: () => new Date() }

/** A clock that starts at `start` and only moves when told to. For tests only. */
export const fixedClock = (start: Date): Clock & { advance: (ms: number) => void } => {
  let current = start.getTime()

  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms
    }
  }
}

/** ISO-8601 in UTC with milliseconds — the only timestamp format written anywhere. */
export const toIso = (date: Date): string => date.toISOString()
