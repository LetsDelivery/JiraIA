import { noticePath } from '../notice-copy.js'
import type { NotificationWithActor } from '../notification.repository.js'
import { facts } from './blocks.js'
import { button, footer, lead, type Message, type Product, pill, shell, title } from './kit.js'

/** What an access message says: who did what, the request's facts, and the one thing to do next. */
type AccessCopy = {
  subject: string
  lead: (string | { bold: string })[]
  headline: string
  facts: [string, string][]
  status?: { text: string; tone: 'new' | 'old' | 'warn' } | undefined
  cta: string
  reason: string
}

type Data = Record<string, string | number | undefined>

const OUTCOME: Record<string, { text: string; tone: 'new' | 'old' }> = {
  approved: { text: 'Aprovado', tone: 'new' },
  done: { text: 'Concluído', tone: 'new' },
  declined: { text: 'Recusado', tone: 'old' }
}

const _what = (data: Data): string => (data.requestKind === 'removal' ? 'Remoção de acesso' : 'Concessão de acesso')

const _request = (data: Data): [string, string][] => [
  ['Sistema', String(data.systemName ?? '')],
  ['Perfil', String(data.profileName ?? '')],
  ['Para quem', String(data.personName ?? '')]
]

const _waiting = (_: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `Pedido de acesso esperando você: ${data.systemName} · ${data.profileName}`,
  lead: ['Um pedido de acesso espera a sua ação'],
  headline: `${_what(data)} · ${data.systemName}`,
  facts: _request(data),
  cta: 'Abrir a fila de acessos',
  reason: 'Você recebe este e-mail porque cuida deste sistema.'
})

const _decided = (_: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `Seu pedido de acesso foi ${(OUTCOME[String(data.status)]?.text ?? 'atualizado').toLowerCase()}: ${data.systemName}`,
  lead: ['Seu pedido de acesso teve uma resposta'],
  headline: `${_what(data)} · ${data.systemName}`,
  facts: _request(data),
  status: OUTCOME[String(data.status)],
  cta: 'Ver meus acessos',
  reason: 'Você recebe este e-mail porque pediu este acesso ou é para você.'
})

const _overdue = (_: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `Pedido de acesso atrasado: ${data.systemName} · ${data.profileName}`,
  lead: ['Um pedido de acesso passou do prazo'],
  headline: `${_what(data)} · ${data.systemName}`,
  facts: _request(data),
  status: { text: 'Fora do prazo', tone: 'warn' },
  cta: 'Resolver agora',
  reason: 'Você recebe este e-mail porque cuida deste sistema.'
})

const _review = (_: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `Revisão de acessos aberta: ${data.systemName}`,
  lead: ['Uma revisão de acessos espera a sua resposta'],
  headline: `Revisão de acessos · ${data.systemName}`,
  facts: [
    ['Sistema', String(data.systemName ?? '')],
    ['Acessos', String(data.itemCount ?? 0)],
    ['Prazo', '10 dias úteis']
  ],
  cta: 'Revisar acessos',
  reason: 'Você recebe este e-mail porque é dono deste sistema.'
})

const _spaceRequest = (row: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `${row.actorName} pediu para editar ${data.spaceName}`,
  lead: [{ bold: row.actorName }, ' pediu para editar um espaço'],
  headline: String(data.spaceName ?? ''),
  facts: [['Quem pediu', row.actorName]],
  cta: 'Responder ao pedido',
  reason: 'Você recebe este e-mail porque administra este espaço.'
})

const _spaceDecided = (_: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `Seu pedido para editar ${data.spaceName} foi ${data.status === 'approved' ? 'aprovado' : 'recusado'}`,
  lead: ['Seu pedido para editar um espaço teve uma resposta'],
  headline: String(data.spaceName ?? ''),
  facts: [],
  status: OUTCOME[String(data.status)],
  cta: 'Abrir o espaço',
  reason: 'Você recebe este e-mail porque pediu este acesso.'
})

const _proposal = (row: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `${row.actorName} propôs mudanças em ${data.spaceName}`,
  lead: [{ bold: row.actorName }, ' propôs mudanças para você aprovar'],
  headline: String(data.spaceName ?? ''),
  facts: [['Quem propôs', row.actorName]],
  cta: 'Ver a proposta',
  reason: 'Você recebe este e-mail porque administra este espaço.'
})

const _sprintOverdue = (_: NotificationWithActor, data: Data): AccessCopy => ({
  subject: `${data.sprintName} de ${data.spaceName} passou da data de fim`,
  lead: ['Uma sprint do seu espaço passou da data de fim'],
  headline: `${data.sprintName} · ${data.spaceName}`,
  facts: [
    [
      'Data de fim',
      String(data.sprintEndsOn ?? '')
        .split('-')
        .reverse()
        .join('/')
    ]
  ],
  status: { text: 'Atrasada', tone: 'warn' },
  cta: 'Abrir o board',
  reason: 'Você recebe este e-mail porque lidera este espaço.'
})

const COPY: Record<string, (row: NotificationWithActor, data: Data) => AccessCopy> = {
  entitlement_waiting: _waiting,
  entitlement_decided: _decided,
  entitlement_overdue: _overdue,
  access_review_opened: _review,
  access_requested: _spaceRequest,
  access_decided: _spaceDecided,
  proposal_received: _proposal,
  sprint_overdue: _sprintOverdue
}

/** The notice kinds that get a message of their own, sent as they happen — each runs on a deadline. */
export const ACCESS_KINDS = new Set(Object.keys(COPY))

/** One access notice as its own message: who, what, the request's facts, and where to act. */
export const accessEmail = (row: NotificationWithActor, webUrl: string): Message => {
  const data = row.data as Data
  const copy = (COPY[row.kind] ?? _waiting)(row, data)
  const url = `${webUrl}${noticePath(row.kind, data as Record<string, string>)}`
  const product: Product = data.product === 'draw' ? 'draw' : 'jiraia'
  const body = [
    lead(copy.lead),
    title(copy.headline, url),
    copy.status ? `<p style="margin:-8px 0 16px">${pill(copy.status.text, copy.status.tone)}</p>` : '',
    copy.facts.length > 0 ? facts(copy.facts) : '',
    `<div>${button(copy.cta, url)}</div>`
  ].join('')
  return {
    subject: copy.subject,
    html: shell({ product, preheader: copy.subject, body, footer: footer(webUrl, copy.reason) }),
    text: [copy.subject, '', ...copy.facts.map(([label, value]) => `${label}: ${value}`), '', url].join('\n')
  }
}
