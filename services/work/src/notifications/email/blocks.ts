import { avatar, button, C, clock, esc, pill, quote } from './kit.js'

/** Who wrote a comment, when, and what — a mention or a reply waiting for one. */
export type CommentView = {
  authorId: string
  authorName: string
  at: Date
  body: string
  /** "comentou em REQ-37": the action and the thing it happened on. */
  action: string
  /** Where it lives, under the name: the space or the page. */
  where?: string
  url: string
}

/** The time beside a name: "11:17", or "há 8 dias" when the message is a summary. */
export type When = (at: Date) => string

const _byline = (view: CommentView, when: When): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;padding-right:10px">${avatar(view.authorName, view.authorId)}</td>
<td style="vertical-align:top;font-size:13px;line-height:18px"><strong>${esc(view.authorName)}</strong> <span style="color:${C.secondary}">${esc(view.action)}</span> <span style="color:${C.muted}">· ${esc(when(view.at))}</span>${view.where ? `<br><span style="font-size:12px;color:${C.muted}">${esc(view.where)}</span>` : ''}</td>
</tr></table>`

/** A comment as the panel shows one: byline, the words, and the reply link. */
export const comment = (view: CommentView, reader: string, when: When = clock): string =>
  `${_byline(view, when)}${quote(view.body, reader)}<div style="margin-top:8px">${button('Responder', `${view.url}#comentar`, 'secondary')}</div>`

/** A field that changed: what it was, struck out, and what it is now. */
export type ChangeView = { field: string; before: string | null; after: string | null }

const _value = (text: string | null, tone: 'old' | 'new'): string =>
  text ? pill(text, tone) : `<span style="color:${C.faint};font-size:12px">vazio</span>`

/** One row of changes: "Estado  NÃO INICIADO → EM PROGRESSO". A value set for the first time has no arrow. */
export const change = (view: ChangeView): string => {
  const values =
    view.before === null
      ? _value(view.after, 'new')
      : `${_value(view.before, 'old')} <span style="color:${C.muted}">→</span> ${_value(view.after, 'new')}`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="96" style="vertical-align:top;padding:4px 12px 4px 0;font-size:12px;line-height:20px;color:${C.muted}">${esc(view.field)}</td>
<td style="vertical-align:top;padding:4px 0;line-height:20px">${values}</td>
</tr></table>`
}

/** A card or a page in a list: key and name as a link, where it lives, and an action on the right. */
export type ItemView = { label: string; url: string; where?: string; action?: { label: string; url: string } }

export const item = (view: ItemView): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;font-size:13px;line-height:18px"><a href="${esc(view.url)}" style="color:${C.fg};font-weight:600;text-decoration:none">${esc(view.label)}</a>${view.where ? `<br><span style="font-size:12px;color:${C.muted}">${esc(view.where)}</span>` : ''}</td>
${view.action ? `<td align="right" style="vertical-align:top;padding-left:12px;white-space:nowrap">${button(view.action.label, view.action.url, 'secondary')}</td>` : ''}
</tr></table>`

/** Label-value pairs for an access request: Sistema, Perfil, Para quem, Prazo. */
export const facts = (pairs: readonly (readonly [string, string])[]): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${C.bg};border:1px solid ${C.border};border-radius:8px">${pairs
    .map(
      ([label, value]) =>
        `<tr><td width="112" style="padding:8px 12px;font-size:12px;line-height:18px;color:${C.muted};vertical-align:top">${esc(label)}</td><td style="padding:8px 12px 8px 0;font-size:13px;line-height:18px;color:${C.fg};font-weight:600">${esc(value)}</td></tr>`
    )
    .join('')}</table>`
