import { type ChangeView, type CommentView, change, comment } from './blocks.js'
import { avatar, button, C, clock, esc, eyebrow, footer, lead, type Message, rows, shell, title } from './kit.js'

/** The card a message is about, as the panel names it. */
export type CardRef = { key: string; title: string; spaceName: string; url: string }

export type MentionView = { readerName: string; card: CardRef; comment: CommentView; webUrl: string }

/** Someone mentioned the reader on a card — sent as it happens, one message per mention. */
export const mentionEmail = (view: MentionView): Message => {
  const who = view.comment.authorName
  const body = [
    lead([{ bold: who }, ' mencionou você em um card']),
    eyebrow(`${view.card.spaceName} / ${view.card.key}`),
    title(view.card.title, view.card.url),
    comment(view.comment, view.readerName),
    `<div style="margin-top:24px">${button('Abrir o card', view.card.url)}</div>`
  ].join('')
  return {
    subject: `${who} mencionou você em ${view.card.key}`,
    html: shell({
      product: 'jiraia',
      preheader: view.comment.body,
      body,
      footer: footer(view.webUrl, 'Você recebe este e-mail porque foi mencionado.')
    }),
    text: [
      `${who} mencionou você em ${view.card.key} · ${view.card.title}`,
      '',
      view.comment.body,
      '',
      view.card.url
    ].join('\n')
  }
}

/** What one member did to the card in the window: fields changed, or a comment. */
export type UpdateView = {
  actorId: string
  actorName: string
  at: Date
  changes: readonly ChangeView[]
  comment?: string
}

export type UpdatesView = { card: CardRef; updates: readonly UpdateView[]; webUrl: string }

/** How many things changed: each field counts, and so does each comment. */
const _count = (updates: readonly UpdateView[]): number =>
  updates.reduce((sum, update) => sum + update.changes.length + (update.comment ? 1 : 0), 0)

/** "Ana", "Ana e Bruno", "Ana, Bruno e mais 2". */
export const names = (all: readonly string[]): string => {
  const unique = [...new Set(all)]
  if (unique.length <= 2) {
    return unique.join(' e ')
  }
  return `${unique.slice(0, 2).join(', ')} e mais ${unique.length - 2}`
}

const _update = (update: UpdateView): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px"><tr>
<td style="vertical-align:middle;padding-right:10px">${avatar(update.actorName, update.actorId, 24)}</td>
<td style="vertical-align:middle;font-size:13px"><strong>${esc(update.actorName)}</strong> <span style="color:${C.muted}">· ${esc(clock(update.at))}</span></td>
</tr></table>${update.changes.map(change).join('')}${update.comment ? `<div style="font-size:12px;color:${C.muted};margin-top:4px">comentou</div><div style="padding:8px 12px;background:${C.bg};border:1px solid ${C.border};border-radius:8px;font-size:13px;line-height:20px">${esc(update.comment)}</div>` : ''}`

/** A card the reader follows changed — the changes of a few minutes, grouped, in one message. */
export const updatesEmail = (view: UpdatesView): Message => {
  const who = names(view.updates.map((update) => update.actorName))
  const count = _count(view.updates)
  const verb = new Set(view.updates.map((update) => update.actorId)).size > 1 ? 'fizeram' : 'fez'
  const what = count === 1 ? '1 atualização' : `${count} atualizações`
  const body = [
    lead([{ bold: who }, ` ${verb} ${what}`]),
    eyebrow(`${view.card.spaceName} / ${view.card.key}`),
    title(view.card.title, view.card.url),
    rows(view.updates.map(_update), 20),
    `<div style="margin-top:24px">${button('Abrir o card', view.card.url)}</div>`
  ].join('')
  return {
    subject: `${who} ${verb} ${what} em ${view.card.key}`,
    html: shell({
      product: 'jiraia',
      preheader: `${view.card.key} · ${view.card.title}`,
      body,
      footer: footer(view.webUrl, 'Você recebe este e-mail porque acompanha este card.')
    }),
    text: [
      `${who} ${verb} ${what} em ${view.card.key} · ${view.card.title}`,
      '',
      ...view.updates.flatMap(_textUpdate),
      '',
      view.card.url
    ].join('\n')
  }
}

const _textUpdate = (update: UpdateView): string[] => [
  `${update.actorName} (${clock(update.at)})`,
  ...update.changes.map((each) => `  ${each.field}: ${each.before ?? 'vazio'} → ${each.after ?? 'vazio'}`),
  ...(update.comment ? [`  comentou: ${update.comment}`] : [])
]
