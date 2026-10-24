import type { Database } from '@jiraia/db'
import { and, desc, eq, inArray, isNull, lte, ne } from 'drizzle-orm'

import { contents, drawSpaces } from '../schema.js'
import { wikiPages } from '../schema-wiki.js'
import type { WikiPageRow } from './page.schemas.js'

/** A wiki page's owner, state and review date (ADR-0033), beside the content it describes. */
export class WikiPageRepository {
  constructor(private readonly db: Database) {}

  async find(contentId: string): Promise<WikiPageRow | undefined> {
    const [row] = await this.db.select().from(wikiPages).where(eq(wikiPages.contentId, contentId))
    return row
  }

  async many(contentIds: readonly string[]): Promise<Map<string, WikiPageRow>> {
    if (contentIds.length === 0) {
      return new Map()
    }
    const rows = await this.db
      .select()
      .from(wikiPages)
      .where(inArray(wikiPages.contentId, [...contentIds]))
    return new Map(rows.map((row) => [row.contentId, row]))
  }

  async save(tx: Database, row: WikiPageRow): Promise<void> {
    const { contentId: _contentId, ...fields } = row
    await tx.insert(wikiPages).values(row).onConflictDoUpdate({ target: wikiPages.contentId, set: fields })
  }

  /** The member's official pages whose review date falls on or before `until`, soonest first. */
  async dueFor(ownerId: string, until: Date) {
    return await this.db
      .select({
        contentId: contents.id,
        title: contents.title,
        collectionId: drawSpaces.id,
        collectionName: drawSpaces.name,
        reviewDue: wikiPages.reviewDue
      })
      .from(wikiPages)
      .innerJoin(contents, eq(contents.id, wikiPages.contentId))
      .innerJoin(drawSpaces, eq(drawSpaces.id, contents.spaceId))
      .where(
        and(
          eq(wikiPages.ownerId, ownerId),
          eq(wikiPages.state, 'official'),
          lte(wikiPages.reviewDue, until),
          isNull(contents.deletedAt),
          isNull(drawSpaces.deletedAt)
        )
      )
      .orderBy(wikiPages.reviewDue)
  }

  /** The pages of the organization's collections changed last, with their state when they have one. */
  async recent(organizationId: string, limit: number) {
    return await this.db
      .select({
        contentId: contents.id,
        title: contents.title,
        updatedAt: contents.updatedAt,
        collectionId: drawSpaces.id,
        collectionName: drawSpaces.name,
        collectionIcon: drawSpaces.icon,
        state: wikiPages.state,
        reviewDue: wikiPages.reviewDue
      })
      .from(contents)
      .innerJoin(drawSpaces, eq(drawSpaces.id, contents.spaceId))
      .leftJoin(wikiPages, eq(wikiPages.contentId, contents.id))
      .where(
        and(
          eq(contents.organizationId, organizationId),
          eq(drawSpaces.area, 'wiki'),
          isNull(contents.deletedAt),
          isNull(drawSpaces.deletedAt),
          ne(contents.kind, 'folder')
        )
      )
      .orderBy(desc(contents.updatedAt))
      .limit(limit)
  }
}
