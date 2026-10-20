import {
  type Clock,
  ForbiddenException,
  type IdGenerator,
  NotFoundException,
  toIso,
  ValidationException
} from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail, Changes } from '../audit/audit.js'
import { mentionedIds } from '../cards/mentions.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { ContentCommentView, CreateContentComment } from './content.schemas.js'
import type { ContentCommentRepository, ContentCommentWithAuthor } from './content-comment.repository.js'
import type { ContentAccess, DrawGate } from './draw-gate.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  drawGate: DrawGate
  comments: ContentCommentRepository
  members: MemberRepository
}

type CommentList = { items: ContentCommentView[] }

/**
 * Comments on a page (escopo-mvp 5.7): on the whole page, or on a stretch of its text — then the
 * editor marks the stretch and the thread names the mark. Anyone who reads the page may comment, as
 * on cards; a thread is resolved and reopened by anyone who may comment.
 */
export class ContentCommentService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, contentId: string): Promise<CommentList> {
    const { gate, content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    return await this._list(gate.actor, content.id)
  }

  async create(caller: Caller, contentId: string, input: CreateContentComment): Promise<CommentList> {
    const access = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    if (input.parentId) {
      await this._find(access, input.parentId)
    }
    const mentions = await this._mentions(access.gate.actor, input.body)
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      await this.deps.comments.insert(tx, {
        id,
        contentId: access.content.id,
        parentId: input.parentId ?? null,
        anchorId: input.parentId ? null : (input.anchorId ?? null),
        quote: input.parentId ? null : (input.quote ?? null),
        authorId: access.gate.actor.id,
        body: input.body,
        mentions,
        createdAt: now,
        editedAt: null,
        resolvedAt: null,
        resolvedBy: null
      })
      await this._audit(tx, access, id, 'commented', { body: { before: null, after: input.body } })
    })
    return await this._list(access.gate.actor, access.content.id)
  }

  async edit(caller: Caller, contentId: string, commentId: string, body: string): Promise<CommentList> {
    const access = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    const comment = await this._find(access, commentId)
    if (comment.authorId !== access.gate.actor.id) {
      throw new ForbiddenException('Only the author may edit a comment', { commentId })
    }
    const mentions = await this._mentions(access.gate.actor, body)
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.comments.update(tx, comment.id, { body, mentions, editedAt: now })
      await this._audit(tx, access, comment.id, 'comment_edited', { body: { before: comment.body, after: body } })
    })
    return await this._list(access.gate.actor, access.content.id)
  }

  /** A thread — its first comment — is resolved or reopened. */
  async resolve(caller: Caller, contentId: string, commentId: string, resolved: boolean): Promise<CommentList> {
    const access = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    const comment = await this._find(access, commentId)
    if (comment.parentId) {
      throw new ValidationException(`Comment "${commentId}" is a reply; resolve its thread instead`, { commentId })
    }
    const now = this.deps.clock.now()
    const fields = resolved
      ? { resolvedAt: now, resolvedBy: access.gate.actor.id }
      : { resolvedAt: null, resolvedBy: null }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.comments.update(tx, comment.id, fields)
      await this._audit(tx, access, comment.id, resolved ? 'resolved' : 'reopened', {
        resolved: { before: comment.resolvedAt !== null, after: resolved }
      })
    })
    return await this._list(access.gate.actor, access.content.id)
  }

  private async _find({ content }: ContentAccess, commentId: string) {
    const comment = await this.deps.comments.find(content.id, commentId)
    if (!comment) {
      throw new NotFoundException('Comment', commentId)
    }
    return comment
  }

  private async _mentions(actor: MemberRow, body: string): Promise<string[]> {
    const ids = mentionedIds(body)
    const found = await Promise.all(ids.map((id) => this.deps.members.findById(actor.organizationId, id)))
    const missing = ids.find((_, index) => found[index]?.status !== 'active')
    if (missing) {
      throw new ValidationException(`Mentioned member "${missing}" is not an active member`, { memberId: missing })
    }
    return ids
  }

  private async _list(actor: MemberRow, contentId: string): Promise<CommentList> {
    const [rows, members] = await Promise.all([
      this.deps.comments.list(contentId),
      this.deps.members.list(actor.organizationId)
    ])
    const names = new Map(members.map((member) => [member.id, member.name]))
    return { items: rows.map((row) => _view(row, names)) }
  }

  private async _audit(
    tx: Database,
    { gate, content }: ContentAccess,
    commentId: string,
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: content.spaceId,
      actorId: gate.actor.id,
      entityType: 'content_comment',
      entityId: commentId,
      action,
      changes
    })
  }
}

const _view = (row: ContentCommentWithAuthor, names: Map<string, string>): ContentCommentView => ({
  id: row.id,
  parentId: row.parentId,
  anchorId: row.anchorId,
  quote: row.quote,
  author: { id: row.authorId, name: row.authorName },
  body: row.body,
  mentions: (row.mentions as string[]).map((id) => ({ id, name: names.get(id) ?? '' })),
  createdAt: toIso(row.createdAt),
  editedAt: row.editedAt ? toIso(row.editedAt) : null,
  resolvedAt: row.resolvedAt ? toIso(row.resolvedAt) : null
})
