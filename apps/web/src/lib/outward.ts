import type { ApiToken, Delivery, WebhookEvent } from '@/api/outward'

/** How a token stands now: working, revoked, or past its date. */
export type TokenState = 'active' | 'revoked' | 'expired'

/**
 * @example tokenState({ revokedAt: null, expiresAt: '2026-01-01T00:00:00Z' }, new Date('2026-10-17'))   // 'expired'
 */
export const tokenState = (token: Pick<ApiToken, 'revokedAt' | 'expiresAt'>, now: Date): TokenState => {
  if (token.revokedAt) {
    return 'revoked'
  }
  return token.expiresAt && new Date(token.expiresAt) <= now ? 'expired' : 'active'
}

export const TOKEN_STATE_LABEL: Record<TokenState, string> = {
  active: 'Ativo',
  revoked: 'Revogado',
  expired: 'Vencido'
}

export const EVENT_LABEL: Record<WebhookEvent, string> = {
  'card.created': 'Card criado',
  'card.updated': 'Card alterado',
  'card.moved': 'Card movido',
  'card.commented': 'Comentário',
  'proposal.proposed': 'Proposta recebida',
  'proposal.approved': 'Proposta aprovada',
  'proposal.rejected': 'Proposta recusada',
  'proposal.reverted': 'Proposta revertida',
  'sprint.started': 'Sprint iniciada',
  'sprint.closed': 'Sprint encerrada'
}

export const DELIVERY_LABEL: Record<Delivery['status'], string> = {
  delivered: 'Entregue',
  pending: 'Tentando de novo',
  failed: 'Falhou'
}

/** What went wrong with the last try, in a few words: the HTTP status, or that nothing answered. */
export const deliveryDetail = (delivery: Pick<Delivery, 'status' | 'attempts' | 'lastStatus'>): string => {
  const tries = delivery.attempts === 1 ? '1 tentativa' : `${delivery.attempts} tentativas`
  if (delivery.status === 'delivered') {
    return `${tries} · HTTP ${delivery.lastStatus}`
  }
  return delivery.lastStatus ? `${tries} · respondeu HTTP ${delivery.lastStatus}` : `${tries} · sem resposta`
}
