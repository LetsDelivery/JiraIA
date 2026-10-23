import type { CardWithPeople } from '../cards/schemas.js'
import { type SummaryLine, summaryLine } from '../notifications/notice-copy.js'
import type { NotificationWithActor } from '../notifications/notification.repository.js'
import type { Block } from './slack-api.js'

/**
 * What JiraIA says in Slack (Etapa 5e). Like the daily e-mail, it is read by a person outside the panel,
 * so it speaks pt-BR. Slack's mrkdwn treats `&`, `<` and `>` as markup: they are escaped in every
 * piece of text a person wrote.
 */
export const escapeMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PRIORITY: Record<string, string> = {
  highest: 'Altíssima',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  lowest: 'Baixíssima'
}

const GROUP: Record<string, string> = {
  not_started: 'Não iniciado',
  in_progress: 'Em andamento',
  done: 'Concluído',
  cancelled: 'Cancelado'
}

/** A notice as a direct message: what happened, linked to it, and the card's title or the excerpt. */
export const noticeMessage = (row: NotificationWithActor, webUrl: string): { text: string; blocks: Block[] } => {
  const line: SummaryLine = summaryLine(row, webUrl)
  const detail = line.detail ? `\n${escapeMrkdwn(line.detail)}` : ''
  return {
    text: line.sentence,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `<${line.url}|${escapeMrkdwn(line.sentence)}>${detail}` } }
    ]
  }
}

export type CardFacts = { card: CardWithPeople; typeName: string; stateName: string; stateGroup: string }

export const cardUrl = (webUrl: string, key: string): string => `${webUrl}/espacos/${key.split('-')[0]}?card=${key}`

/** A card's preview: key and title as the link, then its state, type, assignee and priority. */
export const cardPreview = ({ card, typeName, stateName, stateGroup }: CardFacts, webUrl: string): Block[] => {
  const key = `${card.spaceKey}-${card.number}`
  const facts = [
    `*Estado:* ${escapeMrkdwn(stateName)} (${GROUP[stateGroup] ?? stateGroup})`,
    `*Tipo:* ${escapeMrkdwn(typeName)}`,
    `*Responsável:* ${escapeMrkdwn(card.assigneeName ?? 'Sem responsável')}`,
    `*Prioridade:* ${PRIORITY[card.priority] ?? card.priority}`
  ]
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*<${cardUrl(webUrl, key)}|${key} ${escapeMrkdwn(card.title)}>*` }
    },
    { type: 'context', elements: facts.map((text) => ({ type: 'mrkdwn', text })) }
  ]
}
