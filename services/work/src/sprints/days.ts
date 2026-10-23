/**
 * A sprint's dates are calendar days in São Paulo (ADR-0029), written `YYYY-MM-DD`. The arithmetic
 * runs on UTC midnights, where a day is always 24 hours; São Paulo is UTC−3 all year since 2019.
 */
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const _midnight = (day: string): number => Date.parse(`${day}T00:00:00.000Z`)

/** The calendar day it is in São Paulo at `at`. */
export const saoPauloDay = (at: Date): string => new Date(at.getTime() + SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10)

/** `day` moved by `days`, either way. */
export const addDays = (day: string, days: number): string =>
  new Date(_midnight(day) + days * DAY_MS).toISOString().slice(0, 10)

/** Whole days from `from` to `to`: 0 for the same day, negative when `to` comes first. */
export const daysBetween = (from: string, to: string): number => Math.round((_midnight(to) - _midnight(from)) / DAY_MS)
