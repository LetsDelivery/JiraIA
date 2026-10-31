import { onInvalidate } from '@/lib/cache'
import { Prefetcher } from '@/lib/prefetch'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

/** An opened card's whole page — the card, its talk, relations, files and history — in one answer. */
export type CardDetail = Json<'/work/cards/{cardId}/detail', 'get'>

const fetchDetail = (cardId: string) => unwrap(api.GET('/work/cards/{cardId}/detail', { params: { path: { cardId } } }))

const ahead = new Prefetcher<CardDetail>(fetchDetail)
onInvalidate(() => ahead.clear())

export const cardDetailRead = {
  /** The pointer rests on a card: its page starts loading before the click. */
  warm: (cardId: string) => ahead.warm(cardId),
  /** Opening a card: what the hover began, if it is fresh. */
  open: (cardId: string) => ahead.take(cardId),
  /** After a write: always the API's answer now. */
  fresh: (cardId: string) => fetchDetail(cardId)
}
