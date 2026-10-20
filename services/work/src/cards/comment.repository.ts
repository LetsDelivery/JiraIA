import type { Database } from '@jiraia/db'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { cardComments, commentReactions, members } from '../schema.js'
import type { CommentRow } from './schemas.js'

const author = alias(members, 'author')

export type CommentWithAuthor = CommentRow & { authorName: string }
export type ReactionRow = typeof commentReactions.$inferSelect

export class CommentRepository {
  constructor(private readonly db: Database) {}

  async list(cardId: string): Promise<CommentWithAuthor[]> {
    const rows = await this.db
      .select({ comment: cardComments, authorName: author.name })
      .from(cardComments)
      .innerJoin(author, eq(author.id, cardComments.authorId))
      .where(eq(cardComments.cardId, cardId))
      .orderBy(asc(cardComments.createdAt))

    return rows.map((row) => ({ ...row.comment, authorName: row.authorName }))
  }

  async find(cardId: string, commentId: string): Promise<CommentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cardComments)
      .where(and(eq(cardComments.cardId, cardId), eq(cardComments.id, commentId)))
    return row
  }

  async insert(tx: Database, row: CommentRow): Promise<void> {
    await tx.insert(cardComments).values(row)
  }

  async edit(tx: Database, id: string, fields: Pick<CommentRow, 'body' | 'mentions' | 'editedAt'>): Promise<void> {
    await tx.update(cardComments).set(fields).where(eq(cardComments.id, id))
  }

  /** A comment and its reactions, gone — only a reverted proposal takes one back (ADR-0019). */
  async remove(tx: Database, id: string): Promise<void> {
    await tx.delete(commentReactions).where(eq(commentReactions.commentId, id))
    await tx.delete(cardComments).where(eq(cardComments.id, id))
  }

  /** The reactions on these comments, oldest first, so each emoji keeps the order people reacted in. */
  async reactions(commentIds: readonly string[]): Promise<ReactionRow[]> {
    if (commentIds.length === 0) {
      return []
    }
    return await this.db
      .select()
      .from(commentReactions)
      .where(inArray(commentReactions.commentId, [...commentIds]))
      .orderBy(asc(commentReactions.createdAt))
  }

  async react(row: ReactionRow): Promise<void> {
    await this.db.insert(commentReactions).values(row).onConflictDoNothing()
  }

  async unreact(commentId: string, memberId: string, emoji: string): Promise<void> {
    await this.db
      .delete(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.memberId, memberId),
          eq(commentReactions.emoji, emoji)
        )
      )
  }
}
