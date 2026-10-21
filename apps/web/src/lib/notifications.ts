import type { Channel, Notice, NoticeKind } from '@/api/notifications'

import { drawSpacePath } from './draw'
import { spacePath } from './space-types'

/**
 * A notice as the sentence a person reads, and where clicking it goes (escopo-mvp 4.6).
 *
 * @example sentence({ kind: 'mentioned', actor: { name: 'Ana' }, data: { cardKey: 'PRD-4' } })   // 'Ana mencionou você em PRD-4'
 */
/** What became of an entitlement request (ADR-0024), in the notice's words. */
const OUTCOME: Record<string, string> = { approved: 'aprovado', declined: 'recusado', done: 'concluído' }

export const sentence = (notice: Pick<Notice, 'kind' | 'actor' | 'data'>): string => {
  const { actor, data } = notice
  const sentences: Record<NoticeKind, () => string> = {
    mentioned: () => `${actor.name} mencionou você em ${data.cardKey}`,
    assigned: () => `${actor.name} atribuiu ${data.cardKey} a você`,
    commented: () => `${actor.name} comentou em ${data.cardKey}`,
    state_changed: () => `${actor.name} moveu ${data.cardKey} para ${data.stateName}`,
    access_requested: () => `${actor.name} pediu para editar ${data.spaceName}`,
    access_decided: () =>
      `Seu pedido para editar ${data.spaceName} foi ${data.status === 'approved' ? 'aprovado' : 'recusado'}`,
    proposal_received: () => `${actor.name} propôs mudanças em ${data.spaceName}`,
    entitlement_waiting: () =>
      `Pedido de acesso esperando você: ${data.systemName} · ${data.profileName} para ${data.personName}`,
    entitlement_decided: () =>
      `Pedido de acesso ${OUTCOME[data.status ?? ''] ?? 'atualizado'}: ${data.systemName} · ${data.profileName}`,
    entitlement_overdue: () =>
      `Pedido de acesso atrasado: ${data.systemName} · ${data.profileName} para ${data.personName}`
  }
  return sentences[notice.kind]()
}

/**
 * A card notice opens the card; a proposal notice, the proposal; an access notice, the place the
 * request is about.
 */
/** An entitlement notice opens the queue for whoever acts on it, Meus acessos for whoever asked. */
const _accessTarget = (kind: Notice['kind']): string => (kind === 'entitlement_decided' ? '/acessos' : '/acessos/fila')

export const target = (notice: Pick<Notice, 'kind' | 'data' | 'spaceId'>): string => {
  if (notice.data.requestId) {
    return _accessTarget(notice.kind)
  }
  if (notice.data.proposalId) {
    return `/propostas?proposta=${notice.data.proposalId}`
  }
  if (notice.data.cardKey) {
    return `${spacePath(notice.data.cardKey.split('-')[0] ?? '')}?card=${notice.data.cardKey}`
  }
  if (notice.data.product === 'draw') {
    return drawSpacePath(notice.spaceId ?? '')
  }
  return notice.data.spaceKey ? `${spacePath(notice.data.spaceKey)}?aba=pessoas` : '/espacos'
}

export const KIND_LABEL: Record<NoticeKind, { label: string; hint: string }> = {
  mentioned: { label: 'Menções', hint: 'Alguém citou você com @ num comentário.' },
  assigned: { label: 'Atribuições', hint: 'Um card passou a ser seu.' },
  commented: { label: 'Comentários', hint: 'Comentaram num card que você observa.' },
  state_changed: { label: 'Mudanças de estado', hint: 'Um card que você observa mudou de estado.' },
  access_requested: { label: 'Pedidos de acesso', hint: 'Alguém pediu para editar um espaço que você administra.' },
  access_decided: { label: 'Respostas a pedidos', hint: 'Seu pedido para editar foi aprovado ou recusado.' },
  proposal_received: {
    label: 'Propostas de agentes',
    hint: 'Um agente propôs mudanças num espaço que você administra.'
  },
  entitlement_waiting: {
    label: 'Fila de acessos',
    hint: 'Um pedido de acesso a um sistema que você aprova ou executa.'
  },
  entitlement_decided: { label: 'Seus pedidos de acesso', hint: 'Um pedido seu foi aprovado, recusado ou concluído.' },
  entitlement_overdue: {
    label: 'Acessos atrasados',
    hint: 'Um pedido de um sistema seu passou do prazo.'
  }
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  in_app: 'Só no JiraIA',
  email: 'JiraIA e e-mail diário',
  slack: 'JiraIA e Slack',
  none: 'Não avisar'
}

/** 08:00 in São Paulo is 11:00 UTC — Brazil keeps no daylight saving time. */
const MORNING_UTC = 11

/**
 * When a snooze ends: tomorrow at 08:00, or next Monday at 08:00, São Paulo time.
 *
 * @example snoozeUntil('tomorrow', new Date('2026-10-17T15:00:00Z'))   // '2026-10-18T11:00:00.000Z'
 */
export const snoozeUntil = (when: 'tomorrow' | 'next_week', now: Date): string => {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), MORNING_UTC))
  const ahead = when === 'tomorrow' ? 1 : (8 - now.getUTCDay()) % 7 || 7
  day.setUTCDate(day.getUTCDate() + ahead)
  return day.toISOString()
}
