import type { Database } from '@jiraia/db'
import { and, asc, eq } from 'drizzle-orm'

import { contentComments, members } from '../schema.js'
import type { ContentCommentRow } from './content.schemas.js'

export type ContentCommentWithAuthor = ContentCommentRow & { authorName: string }

export class ContentCommentRepository {
  constructor(private readonly db: Database) {}

  async list(contentId: string): Promise<ContentCommentWithAuthor[]> {
    const rows = await this.db
      .select({ comment: contentComments, authorName: members.name })
      .from(contentComments)
      .innerJoin(members, eq(members.id, contentComments.authorId))
      .where(eq(contentComments.contentId, contentId))
      .orderBy(asc(contentComments.createdAt))
    return rows.map((row) => ({ ...row.comment, authorName: row.authorName }))
  }

  async find(contentId: string, commentId: string): Promise<ContentCommentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(contentComments)
      .where(and(eq(contentComments.contentId, contentId), eq(contentComments.id, commentId)))
    return row
  }

  async insert(tx: Database, row: ContentCommentRow): Promise<void> {
    await tx.insert(contentComments).values(row)
  }

  async update(
    tx: Database,
    id: string,
    fields: Partial<Pick<ContentCommentRow, 'body' | 'mentions' | 'editedAt' | 'resolvedAt' | 'resolvedBy'>>
  ) {
    await tx.update(contentComments).set(fields).where(eq(contentComments.id, id))
  }
}
