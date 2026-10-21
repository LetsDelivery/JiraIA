import type { Duty, EntitlementRequest, Privilege, RequestStatus } from '@/api/governance'

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
