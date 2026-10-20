import type { NotificationWithActor } from './notification.repository.js'
import type { NotificationKind } from './schemas.js'

/**
 * The daily summary's words. An e-mail is read by a person outside the panel, so — like the panel's
 * own strings — it speaks pt-BR; nothing else in the service does.
 */
const SENTENCE: Record<NotificationKind, (row: NotificationWithActor, data: Record<string, string>) => string> = {
  mentioned: (row, data) => `${row.actorName} mencionou você em ${data.cardKey}`,
  assigned: (row, data) => `${row.actorName} atribuiu ${data.cardKey} a você`,
  commented: (row, data) => `${row.actorName} comentou em ${data.cardKey}`,
  state_changed: (row, data) => `${row.actorName} moveu ${data.cardKey} para ${data.stateName}`,
  access_requested: (row, data) => `${row.actorName} pediu para editar ${data.spaceName}`,
  access_decided: (_, data) =>
    `Seu pedido para editar ${data.spaceName} foi ${data.status === 'approved' ? 'aprovado' : 'recusado'}`,
  proposal_received: (row, data) => `${row.actorName} propôs mudanças em ${data.spaceName}`
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type SummaryLine = { sentence: string; detail: string; url: string }

export const summaryLine = (row: NotificationWithActor, webUrl: string): SummaryLine => {
  const data = row.data as Record<string, string>
  const key = data.cardKey ?? ''
  const url = key
    ? `${webUrl}/espacos/${key.split('-')[0]}?card=${key}`
    : data.proposalId
      ? `${webUrl}/propostas?proposta=${data.proposalId}`
      : `${webUrl}/notificacoes`
  return {
    sentence: SENTENCE[row.kind as NotificationKind]?.(row, data) ?? row.kind,
    detail: data.cardTitle ?? data.excerpt ?? '',
    url
  }
}

/** One message for one person: every unread notice since the last summary, newest last. */
export const summaryEmail = (name: string, lines: readonly SummaryLine[], webUrl: string) => {
  const subject = lines.length === 1 ? 'JiraIA: 1 novidade para você' : `JiraIA: ${lines.length} novidades para você`
  const items = lines
    .map(
      (line) =>
        `<li style="margin:0 0 12px"><a href="${escapeHtml(line.url)}" style="color:#1d1817;font-weight:600">${escapeHtml(line.sentence)}</a>${line.detail ? `<br><span style="color:#776d6a">${escapeHtml(line.detail)}</span>` : ''}</li>`
    )
    .join('')
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#1d1817;max-width:560px">
<p>Olá, ${escapeHtml(name.split(' ')[0] ?? name)}. Isto aconteceu no JiraIA e você ainda não viu:</p>
<ul style="padding-left:18px">${items}</ul>
<p style="color:#776d6a;font-size:12px">Escolha o que chega por e-mail em <a href="${escapeHtml(webUrl)}/notificacoes?aba=preferencias">Notificações → Preferências</a>.</p></div>`
  const text = [
    `Olá, ${name}. Isto aconteceu no JiraIA e você ainda não viu:`,
    '',
    ...lines.map((line) => `- ${line.sentence}: ${line.url}`)
  ].join('\n')
  return { subject, html, text }
}
