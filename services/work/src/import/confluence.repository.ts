import type { Database } from '@jiraia/db'
import { eq, sql } from 'drizzle-orm'

import {
  auditEvents,
  contentComments,
  contentFiles,
  contents,
  contentVersions,
  drawSpaceMembers,
  drawSpaces,
  members
} from '../schema.js'

export type DrawSpaceInsert = typeof drawSpaces.$inferInsert
export type ContentInsert = typeof contents.$inferInsert
export type FileInsert = typeof contentFiles.$inferInsert
export type VersionInsert = typeof contentVersions.$inferInsert
export type ContentCommentInsert = typeof contentComments.$inferInsert
export type AuditInsert = typeof auditEvents.$inferInsert

/**
 * The Confluence importer's writes into LET'S Draw (Etapa 8e, ADR-0036), past the services: those take
 * the clock and the signed-in caller, and leave events undispatched, which would notify about the past.
 */
export class ConfluenceRepository {
  constructor(private readonly db: Database) {}

  /** Every member's name, for an `@mention` in a page; and who is active, to edit the imported spaces. */
  async people(organizationId: string): Promise<{ names: Map<string, string>; active: string[] }> {
    const rows = await this.db
      .select({ id: members.id, name: members.name, status: members.status, kind: members.kind })
      .from(members)
      .where(eq(members.organizationId, organizationId))
    return {
      names: new Map(rows.map((row) => [row.id, row.name])),
      active: rows.filter((row) => row.status === 'active' && row.kind === 'person').map((row) => row.id)
    }
  }

  async insertSpace(tx: Database, row: DrawSpaceInsert): Promise<void> {
    await tx.insert(drawSpaces).values(row)
  }

  async renameSpace(tx: Database, id: string, name: string, at: Date): Promise<void> {
    await tx.update(drawSpaces).set({ name, updatedAt: at }).where(eq(drawSpaces.id, id))
  }

  /** Roles on the space; one a member already holds is kept as it is. */
  async grant(tx: Database, rows: (typeof drawSpaceMembers.$inferInsert)[]): Promise<void> {
    if (rows.length > 0) {
      await tx.insert(drawSpaceMembers).values(rows).onConflictDoNothing()
    }
  }

  /** New contents, and changed ones brought to Confluence's state; the live document is left alone. */
  async upsertContents(tx: Database, rows: ContentInsert[]): Promise<void> {
    if (rows.length === 0) {
      return
    }
    await tx
      .insert(contents)
      .values(rows)
      .onConflictDoUpdate({
        target: contents.id,
        set: {
          parentId: sql`excluded.parent_id`,
          kind: sql`excluded.kind`,
          title: sql`excluded.title`,
          icon: sql`excluded.icon`,
          position: sql`excluded.position`,
          contentJson: sql`excluded.content_json`,
          contentText: sql`excluded.content_text`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`excluded.updated_at`
        }
      })
  }

  async insertFiles(tx: Database, rows: FileInsert[]): Promise<void> {
    if (rows.length > 0) {
      await tx.insert(contentFiles).values(rows)
    }
  }

  async insertVersions(tx: Database, rows: VersionInsert[]): Promise<void> {
    if (rows.length > 0) {
      await tx.insert(contentVersions).values(rows).onConflictDoNothing()
    }
  }

  async insertComments(tx: Database, rows: ContentCommentInsert[]): Promise<void> {
    if (rows.length > 0) {
      await tx.insert(contentComments).values(rows)
    }
  }

  async audit(tx: Database, rows: AuditInsert[]): Promise<void> {
    if (rows.length > 0) {
      await tx.insert(auditEvents).values(rows)
    }
  }
}
