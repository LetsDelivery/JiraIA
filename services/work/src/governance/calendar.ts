/**
 * Business days in São Paulo (ADR-0024), for the SLAs of access governance. Everything is UTC: a
 * São Paulo moment is the UTC one shifted by its offset, which has been −3 h all year since Brazil
 * dropped daylight saving time in 2019.
 */
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** `YYYY-MM-DD` of a date whose UTC fields hold the wanted calendar day. */
const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

/** Easter Sunday of a year (the anonymous Gregorian algorithm), as a UTC midnight. */
export const easter = (year: number): Date => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((8 * b + 13) / 25) + 15) % 30
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const FIXED = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']
/**
 * Good Friday, in days from Easter — the one movable national holiday. Carnival and Corpus Christi
 * are optional days off (ponto facultativo), not holidays: they count as business days unless the
 * organization adds them to its own calendar.
 */
const FROM_EASTER = [-2]

/** Brazil's national holidays of a year, as the law lists them. */
export const nationalHolidays = (year: number): string[] => {
  const sunday = easter(year).getTime()
  return [
    ...FIXED.map((monthDay) => `${year}-${monthDay}`),
    ...FROM_EASTER.map((offset) => isoDay(new Date(sunday + offset * DAY_MS)))
  ].sort()
}

/** Whether a São Paulo day (`YYYY-MM-DD`) is worked: not a weekend, not a holiday. */
export const isBusinessDay = (day: string, holidays: ReadonlySet<string>): boolean => {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay()
  return (
    weekday !== 0 && weekday !== 6 && !holidays.has(day) && !nationalHolidays(Number(day.slice(0, 4))).includes(day)
  )
}

/**
 * The moment `days` business days after `start`, at the same São Paulo time of day: approved on
 * Friday 15:00 with 2 days to go is due Tuesday 15:00 — later if a holiday falls between.
 */
export const addBusinessDays = (start: Date, days: number, holidays: ReadonlySet<string>): Date => {
  let local = start.getTime() + SAO_PAULO_OFFSET_MS
  for (let counted = 0; counted < days; ) {
    local += DAY_MS
    counted += isBusinessDay(isoDay(new Date(local)), holidays) ? 1 : 0
  }
  return new Date(local - SAO_PAULO_OFFSET_MS)
}

export const addHours = (start: Date, hours: number): Date => new Date(start.getTime() + hours * HOUR_MS)
