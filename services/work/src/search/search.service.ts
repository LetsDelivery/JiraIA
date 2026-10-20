import type { Clock } from '@jiraia/core'
import type { Caller } from '@jiraia/http'
import { and, inArray } from 'drizzle-orm'

import type { AccessResolver } from '../access.js'
import type { CardRepository } from '../cards/card.repository.js'
import { type CardView, toCardView } from '../cards/schemas.js'
import type { MemberRow } from '../members/schemas.js'
import { cards } from '../schema.js'
import {
  filterCondition,
  keyCondition,
  likePattern,
  orderOf,
  type Readable,
  textCondition,
  visibleTo
} from './card-query.js'
import type { CardSearch, SearchMatch, TextSearchResult } from './filter.schemas.js'
import type { FoundCard, SearchRepository } from './search.repository.js'

type Deps = { clock: Clock; access: AccessResolver; cards: CardRepository; search: SearchRepository }

/**
 * Finding cards (escopo-mvp 3.4, 3.6): by a structured filter — the equivalent of a JQL query — or by
 * text anywhere. Both answer only with what the caller may open, as the card gate would, one card at a time.
 */
export class SearchService {
  constructor(private readonly deps: Deps) {}

  async cards(caller: Caller, input: CardSearch): Promise<{ items: CardView[] }> {
    const actor = await this.deps.access.actor(caller)
    return { items: await this.run(actor, input) }
  }

  /** A filter run for an actor already known — a saved view runs through here too. */
  async run(actor: MemberRow, input: CardSearch): Promise<CardView[]> {
    const context = { meId: actor.id, now: this.deps.clock.now() }
    const where = and(visibleTo(await this.readable(actor)), filterCondition(input.filter, context))
    const rows = await this.deps.cards.search(where, orderOf(input.order), input.limit)
    return rows.map(toCardView)
  }

  /** The key, the title and the description first; then comments, one line per card. */
  async text(caller: Caller, query: string, limit: number): Promise<TextSearchResult> {
    const actor = await this.deps.access.actor(caller)
    const visible = visibleTo(await this.readable(actor))
    const key = keyCondition(query)
    const [exact, found, comments] = await Promise.all([
      key ? this.deps.search.cards(and(visible, key), 1) : Promise.resolve([]),
      this.deps.search.cards(and(visible, textCondition(query)), limit),
      this.deps.search.comments(visible, likePattern(query), limit)
    ])
    const fromCards = found.map((card) => ({ card: _ref(card), ...matchIn(card, query) }))
    const fromComments = await this._commented(comments, new Set(found.map((card) => card.id)), query)
    return {
      exact: exact[0] ? _ref(exact[0]) : null,
      items: [...fromCards, ...fromComments].slice(0, limit),
      contents: await this._contents(actor, query, limit)
    }
  }

  /** Let’s Draw AI is open to the whole organization, so every member finds every page in it. */
  private async _contents(actor: MemberRow, query: string, limit: number) {
    const rows = await this.deps.search.contents(actor.organizationId, likePattern(query), limit)
    return rows.map(({ text, kind, ...content }) => ({
      ...content,
      kind: kind === 'whiteboard' ? ('whiteboard' as const) : ('page' as const),
      excerpt: excerpt(text || content.title, query)
    }))
  }

  /** Every space is read by the whole organization (ADR-0012), so a member finds every card in it. */
  async readable(actor: MemberRow): Promise<Readable> {
    return { organizationId: actor.organizationId, meId: actor.id }
  }

  private async _commented(comments: { cardId: string; body: string }[], seen: Set<string>, query: string) {
    const first = new Map<string, string>()
    for (const comment of comments.filter((each) => !seen.has(each.cardId) && !first.has(each.cardId))) {
      first.set(comment.cardId, comment.body)
    }
    const found = first.size ? await this.deps.search.cards(inArray(cards.id, [...first.keys()]), first.size) : []
    return found.map((card) => ({
      card: _ref(card),
      match: 'comment' as const,
      excerpt: excerpt(first.get(card.id) ?? '', query)
    }))
  }
}

const _ref = ({ id, key, title, spaceId, state }: FoundCard) => ({ id, key, title, spaceId, state })

/** Where the text was found on the card, and the piece of it to show. */
export const matchIn = (card: FoundCard, query: string): { match: SearchMatch; excerpt: string } => {
  const lower = query.toLowerCase()
  if (card.key.toLowerCase() === lower.trim()) {
    return { match: 'key', excerpt: card.title }
  }
  if (card.title.toLowerCase().includes(lower)) {
    return { match: 'title', excerpt: card.title }
  }
  return { match: 'description', excerpt: excerpt(card.description, query) }
}

/**
 * Up to `around` characters each side of where `query` first appears, on one line.
 *
 * @example excerpt('Contexto: o lojista quer rastreio em tempo real', 'rastreio', 10)   // '…ista quer rastreio em tempo …'
 */
export const excerpt = (text: string, query: string, around = 60): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) {
    return flat.slice(0, around * 2)
  }
  const start = Math.max(0, at - around)
  const end = Math.min(flat.length, at + query.length + around)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}
