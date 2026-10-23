/**
 * The pieces every e-mail is built from. Mail clients ignore stylesheets and most of CSS, so each
 * piece is a table with inline styles; the colours are the panel's tokens (apps/web tokens.css),
 * written as hex because clients do not read `rgb(… / alpha)`. Every value that came from a person
 * goes through `esc` — a title or a comment never writes markup.
 */
import type { Email } from '../mailer.js'

/** A message before it has a recipient. */
export type Message = Omit<Email, 'to'>
export type Product = 'jiraia' | 'draw'

/** The panel's light tokens, flattened onto white. */
export const C = {
  bg: '#faf8f7',
  surface: '#ffffff',
  border: '#ebe6e5',
  borderStrong: '#ddd5d3',
  fg: '#1d1817',
  secondary: '#4b4240',
  muted: '#776d6a',
  faint: '#a69c99',
  accent: '#f93846',
  accentSoft: '#feebec',
  accentInk: '#b4232f',
  done: '#1f8f55',
  doneSoft: '#e4f3eb',
  warn: '#a8620a',
  warnSoft: '#fcf1e1'
} as const

const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"

/** The squad hues, so a person's initials keep one colour across every e-mail. */
const AVATAR = ['#d9480f', '#c92a2a', '#0c8599', '#7048e8', '#2f9e44', '#1971c2']

export const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The product's wordmark, as on the splash: the last word in the accent. */
export const wordmark = (product: Product, size = 20): string => {
  const [name, tail] = product === 'draw' ? ['LET’S Draw ', 'AI'] : ['Jira', 'IA']
  return `<span style="font-family:${FONT};font-size:${size}px;font-weight:700;letter-spacing:-0.02em;color:${C.fg}">${name}<span style="color:${C.accent}">${tail}</span></span>`
}

export const productName = (product: Product): string => (product === 'draw' ? 'LET’S Draw AI' : 'JiraIA')

type Shell = { product: Product; preheader: string; body: string; footer: string }

/** The page around every message: the wordmark, one white surface, and why it arrived. */
export const shell = ({ product, preheader, body, footer }: Shell): string => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:${C.fg}">
<tr><td style="padding:0 4px 20px">${wordmark(product)}</td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:24px">${body}</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${C.muted}">${footer}</td></tr>
</table></td></tr></table></body></html>`

/** Why the person got it and where to stop it — the same words under every message. */
export const footer = (webUrl: string, reason: string): string =>
  `${esc(reason)} Escolha o que chega por e-mail em <a href="${esc(`${webUrl}/notificacoes?aba=preferencias`)}" style="color:${C.muted}">Notificações → Preferências</a>.<br>LET’S · ${esc(webUrl.replace(/^https?:\/\//, ''))}`

export type ButtonKind = 'primary' | 'secondary'

/** A link that looks like the panel's buttons: the accent for the one action, outline for the rest. */
export const button = (label: string, url: string, kind: ButtonKind = 'primary'): string => {
  const look =
    kind === 'primary'
      ? `background:${C.accent};color:#ffffff;border:1px solid ${C.accent}`
      : `background:${C.surface};color:${C.fg};border:1px solid ${C.borderStrong}`
  const pad = kind === 'primary' ? '10px 18px' : '6px 12px'
  return `<a href="${esc(url)}" style="${look};display:inline-block;padding:${pad};border-radius:8px;font-size:13px;font-weight:600;line-height:16px;text-decoration:none">${esc(label)}</a>`
}

/** A small link under a list: "Ver todas as notificações". */
export const textLink = (label: string, url: string): string =>
  `<a href="${esc(url)}" style="color:${C.accentInk};font-size:13px;font-weight:600;text-decoration:none">${esc(label)}</a>`

const _hue = (seed: string): string => {
  let sum = 0
  for (const char of seed) {
    sum = (sum * 31 + char.charCodeAt(0)) % 997
  }
  return AVATAR[sum % AVATAR.length] ?? C.accent
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

/** A person's initials in their colour; agents and people look the same in a message. */
export const avatar = (name: string, seed: string, size = 28): string =>
  `<span style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;border-radius:50%;background:${_hue(seed)};color:#ffffff;font-size:${Math.round(size * 0.4)}px;font-weight:600;text-align:center">${esc(initials(name))}</span>`

/** "Requisições / REQ-29" above a title. */
export const eyebrow = (text: string): string =>
  `<p style="margin:0 0 4px;font-size:12px;line-height:16px;color:${C.muted}">${esc(text)}</p>`

/** A card's or a page's name, as the link that opens it. */
export const title = (text: string, url: string): string =>
  `<p style="margin:0 0 16px;font-size:18px;line-height:24px;font-weight:600"><a href="${esc(url)}" style="color:${C.fg};text-decoration:none">${esc(text)}</a></p>`

/** The sentence that opens a message: "<b>Ana</b> mencionou você". Pieces in `bold` are names. */
export const lead = (parts: readonly (string | { bold: string })[]): string =>
  `<p style="margin:0 0 16px;font-size:14px;line-height:20px;color:${C.secondary}">${parts.map(_part).join('')}</p>`

const _part = (part: string | { bold: string }): string =>
  typeof part === 'string' ? esc(part) : `<strong style="color:${C.fg}">${esc(part.bold)}</strong>`

/** A section's heading inside the surface: "Menções esperando resposta (5)". */
export const heading = (text: string): string =>
  `<p style="margin:24px 0 12px;font-size:14px;line-height:20px;font-weight:600;color:${C.fg}">${esc(text)}</p>`

/** A small rounded label: a state, a field's old or new value, an outcome. */
export const pill = (text: string, tone: 'old' | 'new' | 'warn' | 'plain' = 'plain'): string => {
  const look = {
    old: `background:${C.accentSoft};color:${C.accentInk};text-decoration:line-through`,
    new: `background:${C.doneSoft};color:${C.done}`,
    warn: `background:${C.warnSoft};color:${C.warn}`,
    plain: `background:${C.bg};color:${C.secondary};border:1px solid ${C.border}`
  }[tone]
  return `<span style="${look};display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;line-height:16px;font-weight:600">${esc(text)}</span>`
}

/** Plain text with the name `@Name` of whoever reads it marked, as the panel marks a mention. */
export const quote = (text: string, highlight?: string): string => {
  const safe = esc(text)
  const marked = highlight
    ? safe
        .split(esc(`@${highlight}`))
        .join(
          `<span style="background:${C.accentSoft};color:${C.accentInk};border-radius:4px;padding:0 3px;font-weight:600">${esc(`@${highlight}`)}</span>`
        )
    : safe
  return `<div style="margin:8px 0 0;padding:10px 12px;background:${C.bg};border:1px solid ${C.border};border-radius:8px;font-size:13px;line-height:20px;color:${C.fg}">${marked}</div>`
}

const TIME = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' })
const SHORT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'short' })

/** "11:17", in São Paulo — the only zone a person at LET’S reads. */
export const clock = (at: Date): string => TIME.format(at)

/** "23 de outubro de 2026", in São Paulo. */
export const longDate = (at: Date): string => DAY.format(at)

/** "17 de out.", in São Paulo. */
export const shortDate = (at: Date): string => SHORT.format(at)

const DAY_MS = 86_400_000

/** "hoje", "ontem", "há 8 dias" — counted in whole days, which no time zone moves by more than one. */
export const ago = (at: Date, now: Date): string => {
  const days = Math.floor((now.getTime() - at.getTime()) / DAY_MS)
  if (days <= 0) {
    return 'hoje'
  }
  return days === 1 ? 'ontem' : `há ${days} dias`
}

/** One block per line of a table, with the gap the panel puts between list rows. */
export const rows = (blocks: readonly string[], gap = 16): string =>
  blocks.map((block, index) => `<div style="${index > 0 ? `margin-top:${gap}px` : ''}">${block}</div>`).join('')
