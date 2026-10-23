import type { CommentView } from './email/blocks.js'
import type { CardRef, UpdateView } from './email/card-emails.js'
import type { ChangedContentView, OpenCardView } from './email/summary-emails.js'
import type { NotificationWithActor } from './notification.repository.js'
import type { CardChange, NotificationData } from './schemas.js'
import type { OpenCard, WaitingMention } from './weekly.repository.js'

/**
 * From the notices the database keeps to what each e-mail template reads (Etapa 5f). The templates
 * know nothing of notices; these functions know nothing of markup.
 */

const _data = (row: { data: unknown }): NotificationData => row.data as NotificationData

/** Where a card opens in the panel. */
export const cardUrl = (webUrl: string, cardKey: string): string =>
  `${webUrl}/espacos/${cardKey.split('-')[0]}?card=${cardKey}`

/** Where a Draw page or whiteboard opens. */
export const contentUrl = (webUrl: string, spaceId: string | null, contentId: string): string =>
  `${webUrl}/draw/${spaceId ?? ''}/${contentId}`

export const cardRef = (row: NotificationWithActor, webUrl: string): CardRef => {
  const data = _data(row)
  const key = data.cardKey ?? ''
  return { key, title: data.cardTitle ?? '', spaceName: data.spaceName ?? '', url: cardUrl(webUrl, key) }
}

/** A notice that names a comment, as the comment block shows it. */
export const commentOf = (row: NotificationWithActor, webUrl: string): CommentView => ({
  authorId: row.actorId,
  authorName: row.actorName,
  at: row.createdAt,
  body: _data(row).excerpt ?? '',
  action: 'comentou',
  url: cardRef(row, webUrl).url
})

/**
 * What a card notice changed. A card given on creation carries no change, and a move written before
 * Etapa 5f only its new state; the e-mail still says what happened.
 */
const _changesOf = (row: NotificationWithActor, readerName: string): CardChange[] => {
  const data = _data(row)
  if (data.changes?.length) {
    return data.changes
  }
  const fallback: Record<string, CardChange> = {
    assigned: { field: 'Responsável', before: null, after: readerName },
    state_changed: { field: 'Estado', before: null, after: data.stateName ?? null }
  }
  return fallback[row.kind] ? [fallback[row.kind] as CardChange] : []
}

const _update = (row: NotificationWithActor, readerName: string): UpdateView => {
  const comment = row.kind === 'commented' ? _data(row).excerpt : undefined
  const update = {
    actorId: row.actorId,
    actorName: row.actorName,
    at: row.createdAt,
    changes: _changesOf(row, readerName)
  }
  return comment ? { ...update, comment } : update
}

/** The next update joins the last one when the same person made both and no comment closed it. */
const _joins = (last: UpdateView | undefined, next: UpdateView): last is UpdateView =>
  last !== undefined && last.actorId === next.actorId && !last.comment

const _add = (updates: UpdateView[], next: UpdateView): void => {
  const last = updates.at(-1)
  if (_joins(last, next)) {
    updates[updates.length - 1] = { ...next, at: last.at, changes: [...last.changes, ...next.changes] }
    return
  }
  updates.push(next)
}

/** One card's notices as the updates the e-mail lists; one actor's run of notices is one update. */
export const updatesOf = (rows: readonly NotificationWithActor[], readerName: string): UpdateView[] => {
  const updates: UpdateView[] = []
  for (const row of rows) {
    _add(updates, _update(row, readerName))
  }
  return updates
}

/** A Draw mention, as the morning summary shows it. */
export const drawMentionOf = (row: NotificationWithActor, webUrl: string): CommentView => {
  const data = _data(row)
  return {
    authorId: row.actorId,
    authorName: row.actorName,
    at: row.createdAt,
    body: data.excerpt ?? '',
    action: `comentou em ${data.contentTitle ?? ''}`,
    where: `${data.contentKind === 'whiteboard' ? 'Quadro' : 'Página'} · ${data.spaceName ?? ''}`,
    url: contentUrl(webUrl, row.spaceId, data.contentId ?? '')
  }
}

/** A page someone else changed, with everyone who saved a version since the reader was told. */
export const changedOf = (
  row: NotificationWithActor,
  editors: readonly string[],
  webUrl: string
): ChangedContentView => {
  const data = _data(row)
  const url = contentUrl(webUrl, row.spaceId, data.contentId ?? '')
  return {
    kind: data.contentKind === 'whiteboard' ? 'board' : 'page',
    title: data.contentTitle ?? '',
    spaceName: data.spaceName ?? '',
    url,
    historyUrl: `${url}?painel=versoes`,
    editors: editors.length > 0 ? editors : [row.actorName]
  }
}

/** An unanswered mention, for Monday's summary. */
export const waitingOf = (mention: WaitingMention, webUrl: string): CommentView => {
  const data = _data(mention)
  const key = data.cardKey ?? ''
  return {
    authorId: mention.actorId,
    authorName: mention.actorName,
    at: mention.createdAt,
    body: data.excerpt ?? '',
    action: `comentou em ${key}`,
    where: data.spaceName ?? data.cardTitle ?? '',
    url: cardUrl(webUrl, key)
  }
}

/** A card nobody holds, with the link that opens it ready to be taken. */
export const openOf = (card: OpenCard, webUrl: string): OpenCardView => {
  const key = `${card.key}-${card.number}`
  const url = cardUrl(webUrl, key)
  return { key, title: card.title, spaceName: card.spaceName, url, assignUrl: `${url}&atribuir=eu` }
}
