import type { Interval } from './schemas.js'

const DAY = 86_400_000

/**
 * Where the UTC day, ISO week (Monday) or month holding `at` starts — the same cut as Postgres'
 * `date_trunc` over a UTC timestamp, so the server's rows and these keys line up.
 *
 * @example bucketStart(new Date('2026-10-15T18:00:00Z'), 'week')   // 2026-10-12T00:00:00Z (Monday)
 */
export const bucketStart = (at: Date, interval: Interval): Date => {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  if (interval === 'month') {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  }
  if (interval === 'week') {
    const sinceMonday = (day.getUTCDay() + 6) % 7
    return new Date(day.getTime() - sinceMonday * DAY)
  }
  return day
}

const next = (start: Date, interval: Interval): Date => {
  if (interval === 'month') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  }
  return new Date(start.getTime() + (interval === 'week' ? 7 : 1) * DAY)
}

/** The instant a report over the last `days` days starts from: the start of its first bucket. */
export const windowStart = (now: Date, days: number, interval: Interval): Date =>
  bucketStart(new Date(now.getTime() - (days - 1) * DAY), interval)

/**
 * Every bucket from the window's start to the one holding `now`, as `YYYY-MM-DD`, so a quiet day
 * shows as zero instead of disappearing from the axis.
 *
 * @example bucketKeys(new Date('2026-10-17T12:00:00Z'), 3, 'day')   // ['2026-10-15', '2026-10-16', '2026-10-17']
 */
export const bucketKeys = (now: Date, days: number, interval: Interval): string[] => {
  const keys: string[] = []
  const last = bucketStart(now, interval).getTime()
  for (let start = windowStart(now, days, interval); start.getTime() <= last; start = next(start, interval)) {
    keys.push(start.toISOString().slice(0, 10))
  }
  return keys
}

/** `rows` spread over `keys`, a missing key taking `empty`. */
export const fillBuckets = <T>(keys: readonly string[], rows: ReadonlyMap<string, T>, empty: T): T[] =>
  keys.map((key) => rows.get(key) ?? empty)
