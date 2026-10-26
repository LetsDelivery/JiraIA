/**
 * The earliest of some moments, those absent left out; none when all are.
 *
 * @example earliestOf(null, new Date('2026-10-26T11:00:00Z'))   // 2026-10-26T11:00:00Z
 */
export const earliestOf = (...times: readonly (Date | null)[]): Date | null =>
  times.reduce<Date | null>(
    (first, time) => (time && (!first || time.getTime() < first.getTime()) ? time : first),
    null
  )
