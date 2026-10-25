import type { Database } from '@jiraia/db'
import { and, desc, eq, inArray, isNull, lte, ne, type SQL } from 'drizzle-orm'

import { contents, drawSpaces } from '../schema.js'
import { contentVisits } from '../schema-intake.js'
import { wikiFavorites, wikiPages } from '../schema-wiki.js'
import type { WikiPageRow } from './page.schemas.js'

/** One page as a list shows it: where it lives and what its mark says. */
const LINE = {
  contentId: contents.id,
  title: contents.title,
  icon: contents.icon,
  updatedAt: contents.updatedAt,
  collectionId: drawSpaces.id,
  collectionName: drawSpaces.name,
  collectionIcon: drawSpaces.icon,
  state: wikiPages.state,
  reviewDue: wikiPages.reviewDue
}

/** Pages — not folders, not deleted — of the given collections; none when there are no collections. */
const _pagesOf = (collectionIds: readonly string[]): SQL | undefined =>
  and(
    inArray(contents.spaceId, [...collectionIds]),
    isNull(contents.deletedAt),
    isNull(drawSpaces.deletedAt),
    ne(contents.kind, 'folder')
  )

/** A wiki page's owner, state and review date (ADR-0033), and each member's favorites (ADR-0034). */
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

  /**
   * The member's official pages whose review date falls on or before `until`, soonest first — in the
   * collections given, when given (those they still read).
   */
  async dueFor(ownerId: string, until: Date, collectionIds?: readonly string[]) {
    if (collectionIds?.length === 0) {
      return []
    }
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
          collectionIds ? inArray(contents.spaceId, [...collectionIds]) : undefined,
          isNull(contents.deletedAt),
          isNull(drawSpaces.deletedAt)
        )
      )
      .orderBy(wikiPages.reviewDue)
  }

  /** The pages of these collections changed last. */
  async recent(collectionIds: readonly string[], limit: number) {
    if (collectionIds.length === 0) {
      return []
    }
    return await this._lines().where(_pagesOf(collectionIds)).orderBy(desc(contents.updatedAt)).limit(limit)
  }

  /** The pages of these collections the member opened last. */
  async opened(memberId: string, collectionIds: readonly string[], limit: number) {
    if (collectionIds.length === 0) {
      return []
    }
    return await this._lines()
      .innerJoin(contentVisits, eq(contentVisits.contentId, contents.id))
      .where(and(eq(contentVisits.memberId, memberId), _pagesOf(collectionIds)))
      .orderBy(desc(contentVisits.visitedAt))
      .limit(limit)
  }

  /** The member's starred pages in these collections, in the order they starred them. */
  async favorites(memberId: string, collectionIds: readonly string[]) {
    if (collectionIds.length === 0) {
      return []
    }
    return await this._lines()
      .innerJoin(wikiFavorites, eq(wikiFavorites.contentId, contents.id))
      .where(and(eq(wikiFavorites.memberId, memberId), _pagesOf(collectionIds)))
      .orderBy(wikiFavorites.createdAt)
  }

  /** The top-level pages of these collections, newest change first. */
  async topLevel(collectionIds: readonly string[], limit: number) {
    if (collectionIds.length === 0) {
      return []
    }
    return await this._lines()
      .where(and(_pagesOf(collectionIds), isNull(contents.parentId)))
      .orderBy(desc(contents.updatedAt))
      .limit(limit)
  }

  async isFavorite(memberId: string, contentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ contentId: wikiFavorites.contentId })
      .from(wikiFavorites)
      .where(and(eq(wikiFavorites.memberId, memberId), eq(wikiFavorites.contentId, contentId)))
    return row !== undefined
  }

  async favorite(memberId: string, contentId: string, at: Date): Promise<void> {
    await this.db.insert(wikiFavorites).values({ memberId, contentId, createdAt: at }).onConflictDoNothing()
  }

  async unfavorite(memberId: string, contentId: string): Promise<void> {
    await this.db
      .delete(wikiFavorites)
      .where(and(eq(wikiFavorites.memberId, memberId), eq(wikiFavorites.contentId, contentId)))
  }

  private _lines() {
    return this.db
      .select(LINE)
      .from(contents)
      .innerJoin(drawSpaces, eq(drawSpaces.id, contents.spaceId))
      .leftJoin(wikiPages, eq(wikiPages.contentId, contents.id))
      .$dynamic()
  }
}

export type PageLine = Awaited<ReturnType<WikiPageRepository['recent']>>[number]
