import { type CommentView, comment, item } from './blocks.js'
import { names } from './card-emails.js'
import {
  ago,
  button,
  C,
  esc,
  footer,
  heading,
  longDate,
  type Message,
  rows,
  shell,
  shortDate,
  textLink
} from './kit.js'

/** A card nobody holds, in a space the reader worked on lately. */
export type OpenCardView = { key: string; title: string; spaceName: string; url: string; assignUrl: string }

/** An official wiki page the reader owns whose review date is near or past (ADR-0033). */
export type ReviewView = { title: string; collectionName: string; url: string; due: Date; overdue: boolean }

export type WeeklyView = {
  readerName: string
  now: Date
  /** Mentions still unanswered — the newest few, and how many there are in all. */
  mentions: readonly CommentView[]
  mentionTotal: number
  open: readonly OpenCardView[]
  openTotal: number
  /** The reader's wiki pages to review, soonest first. */
  reviews: readonly ReviewView[]
  webUrl: string
}

const _intro = (text: string): string =>
  `<p style="margin:0;font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.01em">${esc(text)}</p>`

const _sub = (text: string): string =>
  `<p style="margin:4px 0 0;font-size:13px;line-height:20px;color:${C.muted}">${esc(text)}</p>`

const _plural = (count: number, one: string, many: string): string => (count === 1 ? `1 ${one}` : `${count} ${many}`)

const _openItem = (card: OpenCardView): string =>
  item({
    label: `${card.key} ${card.title}`,
    url: card.url,
    where: card.spaceName,
    action: { label: 'Atribuir a mim', url: card.assignUrl }
  })

const _reviewItem = (page: ReviewView): string =>
  item({
    label: page.title,
    url: page.url,
    where: `${page.collectionName} · ${page.overdue ? 'revisão vencida em' : 'revisar até'} ${shortDate(page.due)}`,
    action: { label: 'Revisar', url: page.url }
  })

/** The wiki section of Monday's message: only for whoever owns pages to review. */
const _reviews = (view: WeeklyView): string =>
  view.reviews.length === 0
    ? ''
    : heading(`Páginas da wiki para revisar (${view.reviews.length})`) +
      rows(view.reviews.slice(0, 5).map(_reviewItem), 12) +
      (view.reviews.length > 5
        ? `<p style="margin:16px 0 0">${textLink('Ver todas as revisões', `${view.webUrl}/wiki/revisoes`)}</p>`
        : '')

const _weeklySubject = (view: WeeklyView): string => {
  const base = `Sua semana no JiraIA: ${_plural(view.mentionTotal, 'menção', 'menções')} e ${_plural(view.openTotal, 'card sem responsável', 'cards sem responsável')}`
  return view.reviews.length === 0
    ? base
    : `${base}, ${_plural(view.reviews.length, 'página para revisar', 'páginas para revisar')}`
}

/** Monday's message: mentions that wait for an answer, and cards nobody took where the reader works. */
export const weeklyEmail = (view: WeeklyView): Message => {
  const week = new Date(view.now.getTime() - 7 * 86_400_000)
  const when = (at: Date) => ago(at, view.now)
  const body = [
    _intro('Sua semana no JiraIA'),
    _sub(`${shortDate(week)} a ${shortDate(view.now)} · o que espera por você`),
    view.mentions.length > 0 ? heading(`Menções esperando resposta (${view.mentionTotal})`) : '',
    rows(
      view.mentions.map((each) => comment(each, view.readerName, when)),
      20
    ),
    view.mentionTotal > view.mentions.length
      ? `<p style="margin:16px 0 0">${textLink('Ver todas as notificações', `${view.webUrl}/notificacoes`)}</p>`
      : '',
    view.open.length > 0 ? heading(`Cards sem responsável nos seus espaços (${view.openTotal})`) : '',
    rows(view.open.map(_openItem), 12),
    view.openTotal > view.open.length
      ? `<p style="margin:16px 0 0">${textLink('Ver cards sem responsável', `${view.webUrl}/`)}</p>`
      : '',
    _reviews(view),
    `<div style="margin-top:28px">${button('Abrir o JiraIA', view.webUrl)}</div>`
  ].join('')
  const subject = _weeklySubject(view)
  return {
    subject,
    html: shell({
      product: 'jiraia',
      preheader: subject,
      body,
      footer: footer(view.webUrl, 'Você recebe este resumo toda segunda às 8h.')
    }),
    text: _weeklyText(view)
  }
}

const _weeklyText = (view: WeeklyView): string =>
  [
    'Sua semana no JiraIA',
    '',
    `Menções esperando resposta (${view.mentionTotal}):`,
    ...view.mentions.map((each) => `- ${each.authorName} ${each.action}: ${each.body} ${each.url}`),
    '',
    `Cards sem responsável (${view.openTotal}):`,
    ...view.open.map((card) => `- ${card.key} ${card.title} (${card.spaceName}) ${card.url}`),
    ...(view.reviews.length > 0 ? ['', `Páginas da wiki para revisar (${view.reviews.length}):`] : []),
    ...view.reviews.map((page) => `- ${page.title} (${page.collectionName}, até ${shortDate(page.due)}) ${page.url}`)
  ].join('\n')

/** A page or a board the reader helped write that someone else changed since yesterday. */
export type ChangedContentView = {
  kind: 'page' | 'board'
  title: string
  spaceName: string
  url: string
  historyUrl: string
  editors: readonly string[]
}

export type DrawDailyView = {
  readerName: string
  now: Date
  changed: readonly ChangedContentView[]
  mentions: readonly CommentView[]
  webUrl: string
}

const KIND = { page: 'Página', board: 'Quadro' } as const

const _changed = (content: ChangedContentView): string =>
  `${item({ label: content.title, url: content.url, where: `${KIND[content.kind]} · ${content.spaceName}` })}<p style="margin:4px 0 0;font-size:12px;line-height:18px;color:${C.secondary}"><strong>${esc(names(content.editors))}</strong> ${content.editors.length > 1 ? 'fizeram' : 'fez'} alterações · ${textLink('Ver mudanças', content.historyUrl)}</p>`

/** The LET’S Draw AI morning: what changed in what the reader helped write, and where they were named. */
export const drawDailyEmail = (view: DrawDailyView): Message => {
  const body = [
    `<p style="margin:0 0 4px"><span style="display:inline-block;padding:4px 10px;border-radius:6px;background:${C.accentSoft};color:${C.accentInk};font-size:12px;font-weight:700;letter-spacing:0.02em">Resumo diário</span></p>`,
    _intro(longDate(view.now)),
    _sub('O que mudou no que você ajudou a criar, e onde mencionaram você.'),
    view.changed.length > 0 ? heading(`Conteúdos alterados (${view.changed.length})`) : '',
    rows(view.changed.map(_changed), 16),
    view.mentions.length > 0 ? heading(`Menções em comentários (${view.mentions.length})`) : '',
    rows(
      view.mentions.map((each) => comment(each, view.readerName, (at) => ago(at, view.now))),
      20
    ),
    `<div style="margin-top:28px">${button('Abrir o LET’S Draw AI', `${view.webUrl}/draw`)}</div>`
  ].join('')
  const subject = `Resumo diário do LET’S Draw AI: ${_plural(view.changed.length + view.mentions.length, 'novidade', 'novidades')}`
  return {
    subject,
    html: shell({
      product: 'draw',
      preheader: subject,
      body,
      footer: footer(view.webUrl, 'Você recebe este resumo às 8h nos dias em que algo mudou.')
    }),
    text: [
      `Resumo diário do LET’S Draw AI · ${longDate(view.now)}`,
      '',
      ...view.changed.map((each) => `- ${each.title}: ${names(each.editors)} alterou · ${each.historyUrl}`),
      ...view.mentions.map((each) => `- ${each.authorName} ${each.action}: ${each.body} ${each.url}`)
    ].join('\n')
  }
}
