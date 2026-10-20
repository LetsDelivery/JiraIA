import { type Clock, ForbiddenException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail, Changes } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CardRepository } from './card.repository.js'
import type { CardAccess, CardGate } from './card-gate.js'
import type { CommentRepository, CommentWithAuthor, ReactionRow } from './comment.repository.js'
import { mentionedIds } from './mentions.js'
import type { CommentView } from './schemas.js'
import type { WatcherRepository } from './watcher.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  cardGate: CardGate
  cards: CardRepository
  comments: CommentRepository
  watchers: WatcherRepository
  members: MemberRepository
}

/**
 * The conversation on a card (escopo-mvp 2.8): comments with mentions of people and agents, edits by
 * their author, and reactions. Anyone who can read the card can take part — a reader included, as in
 * Jira. Commenting, and being mentioned, makes a member follow the card (2.11).
 */
export class CommentService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, cardId: string): Promise<{ items: CommentView[] }> {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    return await this._list(gate.actor, card.id)
  }

  async create(caller: Caller, cardId: string, body: string): Promise<{ items: CommentView[] }> {
    const access = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const { gate, card } = access
    const mentions = await this._mentions(gate.actor, body)
    const now = this.deps.clock.now()
    const id = this.deps.ids.next()

    await this.deps.db.transaction(async (tx) => {
      await this.deps.comments.insert(tx, {
        id,
        cardId: card.id,
        authorId: gate.actor.id,
        body,
        mentions,
        createdAt: now,
        editedAt: null
      })
      await this.deps.watchers.add(tx, card.id, [gate.actor.id, ...mentions], now)
      await this.deps.cards.touchSpace(tx, card.spaceId, now)
      await this._audit(tx, access, 'commented', { comment: { before: null, after: id } })
    })
    return await this._list(gate.actor, card.id)
  }

  /** Only the author edits a comment; the old text stays in the card's history. */
  async edit(caller: Caller, cardId: string, commentId: string, body: string): Promise<{ items: CommentView[] }> {
    const access = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const comment = await this._comment(access, commentId)
    if (comment.authorId !== access.gate.actor.id) {
      throw new ForbiddenException('Only the author may edit a comment', { commentId })
    }
    const mentions = await this._mentions(access.gate.actor, body)
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      await this.deps.comments.edit(tx, comment.id, { body, mentions, editedAt: now })
      await this.deps.watchers.add(tx, access.card.id, mentions, now)
      await this._audit(tx, access, 'comment_edited', {
        comment: { before: comment.id, after: comment.id },
        body: { before: comment.body, after: body }
      })
    })
    return await this._list(access.gate.actor, access.card.id)
  }

  /**
   * Takes back a comment an applied proposal wrote, when the proposal is reverted (ADR-0019): whoever
   * can write the card's space does it, and only to a comment by the proposal's agent.
   */
  async retract(caller: Caller, cardId: string, commentId: string, authorId: string): Promise<void> {
    const access = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const comment = await this._comment(access, commentId)
    if (comment.authorId !== authorId) {
      throw new ForbiddenException(`Comment "${commentId}" was not written by the proposal's agent`, { commentId })
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.comments.remove(tx, comment.id)
      await this._audit(tx, access, 'comment_removed', {
        comment: { before: comment.id, after: null },
        body: { before: comment.body, after: null }
      })
    })
  }

  /** One emoji per member per comment; sending it again with `on: false` takes it back. */
  async react(caller: Caller, cardId: string, commentId: string, input: { emoji: string; on: boolean }) {
    const access = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const comment = await this._comment(access, commentId)
    const memberId = access.gate.actor.id

    if (input.on) {
      await this.deps.comments.react({
        commentId: comment.id,
        memberId,
        emoji: input.emoji,
        createdAt: this.deps.clock.now()
      })
    } else {
      await this.deps.comments.unreact(comment.id, memberId, input.emoji)
    }
    return await this._list(access.gate.actor, access.card.id)
  }

  private async _comment(access: CardAccess, commentId: string) {
    const comment = await this.deps.comments.find(access.card.id, commentId)
    if (!comment) {
      throw new NotFoundException('Comment', commentId)
    }
    return comment
  }

  /** Every member mentioned must be an active member of the organization — a person or an agent. */
  private async _mentions(actor: MemberRow, body: string): Promise<string[]> {
    const ids = mentionedIds(body)
    const found = await Promise.all(ids.map((id) => this.deps.members.findById(actor.organizationId, id)))
    const missing = ids.find((_, index) => found[index]?.status !== 'active')
    if (missing) {
      throw new ValidationException(`Mentioned member "${missing}" is not an active member`, { memberId: missing })
    }
    return ids
  }

  private async _list(actor: MemberRow, cardId: string): Promise<{ items: CommentView[] }> {
    const rows = await this.deps.comments.list(cardId)
    const [reactions, members] = await Promise.all([
      this.deps.comments.reactions(rows.map((row) => row.id)),
      this.deps.members.list(actor.organizationId)
    ])
    const names = new Map(members.map((member) => [member.id, member.name]))
    return { items: rows.map((row) => _view(row, reactions, names)) }
  }

  private async _audit(tx: Database, { gate, card }: CardAccess, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: card.spaceId,
      actorId: gate.actor.id,
      entityType: 'card',
      entityId: card.id,
      action,
      changes
    })
  }
}

const _view = (row: CommentWithAuthor, reactions: readonly ReactionRow[], names: Map<string, string>): CommentView => {
  const emojis = new Map<string, string[]>()
  for (const reaction of reactions.filter((each) => each.commentId === row.id)) {
    emojis.set(reaction.emoji, [...(emojis.get(reaction.emoji) ?? []), reaction.memberId])
  }
  return {
    id: row.id,
    author: { id: row.authorId, name: row.authorName },
    body: row.body,
    mentions: (row.mentions as string[]).map((id) => ({ id, name: names.get(id) ?? '' })),
    reactions: [...emojis].map(([emoji, memberIds]) => ({ emoji, memberIds })),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null
  }
}
