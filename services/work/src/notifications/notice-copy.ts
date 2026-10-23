import type { NotificationWithActor } from './notification.repository.js'
import type { NotificationKind } from './schemas.js'

/**
 * A notice in one sentence, for what is read outside the panel — a Slack message. Like the panel's
 * own strings it speaks pt-BR; nothing else in the service does but the e-mails (`email/`).
 */
const SENTENCE: Record<NotificationKind, (row: NotificationWithActor, data: Record<string, string>) => string> = {
  mentioned: (row, data) => `${row.actorName} mencionou você em ${data.cardKey}`,
  assigned: (row, data) => `${row.actorName} atribuiu ${data.cardKey} a você`,
  commented: (row, data) => `${row.actorName} comentou em ${data.cardKey}`,
  state_changed: (row, data) => `${row.actorName} moveu ${data.cardKey} para ${data.stateName}`,
  access_requested: (row, data) => `${row.actorName} pediu para editar ${data.spaceName}`,
  access_decided: (_, data) =>
    `Seu pedido para editar ${data.spaceName} foi ${data.status === 'approved' ? 'aprovado' : 'recusado'}`,
  proposal_received: (row, data) => `${row.actorName} propôs mudanças em ${data.spaceName}`,
  entitlement_waiting: (_, data) =>
    `Pedido de acesso esperando você: ${data.systemName} · ${data.profileName} para ${data.personName}`,
  entitlement_decided: (_, data) =>
    `Pedido de acesso ${OUTCOME[data.status ?? ''] ?? 'atualizado'}: ${data.systemName} · ${data.profileName}`,
  access_review_opened: (_, data) => `Revisão de acessos aberta: ${data.systemName}`,
  entitlement_overdue: (_, data) =>
    `Pedido de acesso atrasado: ${data.systemName} · ${data.profileName} para ${data.personName}`,
  card_updated: (row, data) => `${row.actorName} atualizou ${data.cardKey}`,
  draw_mentioned: (row, data) => `${row.actorName} mencionou você em ${data.contentTitle}`,
  content_changed: (row, data) => `${row.actorName} alterou ${data.contentTitle}`,
  weekly_summary: () => 'Resumo semanal'
}

/** What became of an entitlement request, in the summary's words. */
const OUTCOME: Record<string, string> = { approved: 'aprovado', declined: 'recusado', done: 'concluído' }

export type SummaryLine = { sentence: string; detail: string; url: string }

/** Where a notice opens: its card, its proposal, the access queue or result, its Draw page, or the inbox. */
export const noticePath = (kind: string, data: Record<string, string>, spaceId: string | null = null): string => {
  if (data.cardKey) {
    return `/espacos/${data.cardKey.split('-')[0]}?card=${data.cardKey}`
  }
  if (data.proposalId) {
    return `/propostas?proposta=${data.proposalId}`
  }
  if (data.reviewId) {
    return '/acessos/revisoes'
  }
  if (data.requestId) {
    return kind === 'entitlement_decided' ? '/acessos' : '/acessos/fila'
  }
  return data.contentId && spaceId ? `/draw/${spaceId}/${data.contentId}` : '/notificacoes'
}

export const summaryLine = (row: NotificationWithActor, webUrl: string): SummaryLine => {
  const data = row.data as Record<string, string>
  return {
    sentence: SENTENCE[row.kind as NotificationKind]?.(row, data) ?? row.kind,
    detail: data.cardTitle ?? data.excerpt ?? '',
    url: `${webUrl}${noticePath(row.kind, data, row.spaceId)}`
  }
}
