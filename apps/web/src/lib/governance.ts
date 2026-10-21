import type { Duty, EntitlementRequest, ImportResult, InventoryRow, Privilege, RequestStatus } from '@/api/governance'

/** Access governance (ADR-0024) in the words of the screen. */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: 'Aguardando aprovação',
  approved: 'Aguardando execução',
  declined: 'Recusada',
  done: 'Concluída',
  cancelled: 'Cancelada'
}

export const KIND_LABEL: Record<EntitlementRequest['kind'], string> = { grant: 'Concessão', removal: 'Remoção' }
export const PRIVILEGE_LABEL: Record<Privilege, string> = { standard: 'Padrão', privileged: 'Privilegiado' }
export const DUTY_LABEL: Record<Duty, string> = { owner: 'Dono', operator: 'Operador' }

/** Who opened a request, when it was not a person asking (ADR-0024). */
export const ORIGIN_LABEL: Record<EntitlementRequest['origin'], string> = {
  request: 'Pedido',
  departure: 'Desligamento',
  expiry: 'Validade vencida',
  review: 'Revisão de acessos',
  inventory: 'Inventário inicial'
}

/** Whether to flag a request as late: on record as breached, or open and already past its deadline. */
export const isLate = (request: Pick<EntitlementRequest, 'overdue' | 'dueAt' | 'status'>, now: Date): boolean =>
  request.overdue || (isOpen(request) && request.dueAt !== null && new Date(request.dueAt).getTime() < now.getTime())

/** The longest a privileged grant lasts (ADR-0024); the server refuses more. */
export const PRIVILEGED_MAX_DAYS = 90

/**
 * The last instant of a São Paulo day, as UTC — "valid until 30/11" means through that day there.
 * São Paulo has kept UTC−3 all year since 2019.
 */
export const endOfDayInSaoPaulo = (day: string): string => new Date(`${day}T23:59:59.000-03:00`).toISOString()

/** What waits on the caller: a decision as owner, or the work as operator. */
export const waitsOnMe = (request: Pick<EntitlementRequest, 'canDecide' | 'canComplete'>): boolean =>
  request.canDecide || request.canComplete

const OPEN: readonly RequestStatus[] = ['requested', 'approved']
export const isOpen = (request: Pick<EntitlementRequest, 'status'>): boolean => OPEN.includes(request.status)

/** Why an inventory row was left out, in the screen's words. */
export const SKIP_LABEL: Record<ImportResult['skipped'][number]['reason'], string> = {
  unknown_person: 'pessoa não encontrada (convide antes)',
  unknown_system: 'sistema não está no catálogo',
  unknown_profile: 'perfil não existe nesse sistema',
  already_held: 'a pessoa já tem esse perfil'
}

/** The columns an inventory sheet may carry, by the names a person would give them. */
const COLUMNS: Record<string, keyof InventoryRow> = {
  email: 'email',
  'e-mail': 'email',
  sistema: 'system',
  perfil: 'profile',
  concedido_em: 'grantedAt',
  desde: 'grantedAt',
  validade: 'expiresAt',
  motivo: 'reason'
}

/** `30/11/2026` or `2026-11-30` as `2026-11-30`; anything else as nothing. */
export const isoDay = (value: string): string | undefined => {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

/**
 * The rows of a pasted inventory, read by its header row: `email`, `sistema`, `perfil`, and optionally
 * `concedido_em`, `validade` and `motivo`.
 */
export const inventoryRows = (table: readonly (readonly string[])[]): InventoryRow[] => {
  const [header = [], ...body] = table
  const keys = header.map((name) => COLUMNS[name.trim().toLowerCase()])
  return body.map((cells) => {
    const pairs = keys.flatMap((key, index) => {
      const value = _cell(key, cells[index])
      return key && value ? [[key, value] as const] : []
    })
    return Object.fromEntries(pairs) as InventoryRow
  })
}

/** A cell as the API wants it: a date as `YYYY-MM-DD`, anything else trimmed. */
const _cell = (key: keyof InventoryRow | undefined, raw: string | undefined): string | undefined => {
  const value = raw?.trim() ?? ''
  return key === 'grantedAt' || key === 'expiresAt' ? isoDay(value) : value
}

/** The calendar quarter a day falls in, as the report's default period. */
export const quarterOf = (today: string): { from: string; to: string } => {
  const year = today.slice(0, 4)
  const first = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1
  const last = first + 2
  const lastDay = new Date(Date.UTC(Number(year), last, 0)).getUTCDate()
  return {
    from: `${year}-${String(first).padStart(2, '0')}-01`,
    to: `${year}-${String(last).padStart(2, '0')}-${lastDay}`
  }
}
