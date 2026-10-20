/**
 * Calendar dates — a due date, a custom date field — as the API keeps them: `YYYY-MM-DD`, no time,
 * no zone. Only UTC methods are used, so the day never shifts with the browser's zone (AGENTS.md).
 */
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
]
export const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export type Month = { year: number; month: number }

const _pad = (value: number): string => String(value).padStart(2, '0')

/** @example isoDate(2026, 10, 30)   // '2026-11-30' — month is 0-based, as in a calendar grid */
export const isoDate = (year: number, month: number, day: number): string => {
  const date = new Date(Date.UTC(year, month, day))
  return `${date.getUTCFullYear()}-${_pad(date.getUTCMonth() + 1)}-${_pad(date.getUTCDate())}`
}

export const monthOf = (iso: string): Month => {
  const [year = '1970', month = '1'] = iso.split('-')
  return { year: Number(year), month: Number(month) - 1 }
}

export const shiftMonth = ({ year, month }: Month, by: number): Month => {
  const date = new Date(Date.UTC(year, month + by, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

/** "novembro de 2026" */
export const monthLabel = ({ year, month }: Month): string => `${MONTHS[month]} de ${year}`

/**
 * The days a month view shows: whole weeks from Sunday, the neighbours' days included.
 *
 * @example monthGrid({ year: 2026, month: 10 })[0]   // '2026-11-01' — 1 Nov 2026 is a Sunday
 */
export const monthGrid = ({ year, month }: Month): string[] => {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const weeks = Math.ceil((first + days) / 7)
  return Array.from({ length: weeks * 7 }, (_, index) => isoDate(year, month, index - first + 1))
}

/** Today in São Paulo, where the company works — not the browser's zone, not UTC's midnight. */
export const todayInSaoPaulo = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now)

/** "30/11/2026", or a dash for no date. */
export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) {
    return '—'
  }
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}
