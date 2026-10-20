import type { Database } from '@jiraia/db'
import { and, asc, count, desc, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm'

import { contents, contentUpdates, drawSpaces } from '../schema.js'
import { contentVisits } from '../schema-intake.js'
import type { ContentRow } from './content.schemas.js'

export type ContentFields = Partial<
  Pick<
    ContentRow,
    'title' | 'parentId' | 'position' | 'document' | 'contentJson' | 'contentText' | 'updatedBy' | 'deletedAt'
  >
>

/** Pages that are not deleted, of one parent — `null` for the top of the tree. */
const _siblings = (spaceId: string, parentId: string | null): SQL | undefined =>
  and(
    eq(contents.spaceId, spaceId),
    parentId ? eq(contents.parentId, parentId) : isNull(contents.parentId),
    isNull(contents.deletedAt)
  )

export class ContentRepository {
  constructor(private readonly db: Database) {}

  /** The pages and whiteboards changed last across the organization's spaces (ADR-0011). */
  async recent(organizationId: string, limit: number) {
    return await this.db
      .select({ content: contents, spaceName: drawSpaces.name, spaceIcon: drawSpaces.icon })
      .from(contents)
      .innerJoin(drawSpaces, eq(drawSpaces.id, contents.spaceId))
      .where(
        and(
          eq(contents.organizationId, organizationId),
          isNull(contents.deletedAt),
          isNull(drawSpaces.deletedAt),
          ne(contents.kind, 'folder')
        )
      )
      .orderBy(desc(contents.updatedAt))
      .limit(limit)
  }

  /** The member opened this content now: one row each, its time moved on (Etapa 4d-c). */
  async visit(memberId: string, contentId: string, at: Date): Promise<void> {
    await this.db
      .insert(contentVisits)
      .values({ memberId, contentId, visitedAt: at })
      .onConflictDoUpdate({ target: [contentVisits.memberId, contentVisits.contentId], set: { visitedAt: at } })
  }

  /** The pages and whiteboards the member opened last, most recent first; those deleted since are left out. */
  async opened(memberId: string, limit: number) {
    return await this.db
      .select({ content: contents, spaceName: drawSpaces.name, spaceIcon: drawSpaces.icon })
      .from(contentVisits)
      .innerJoin(contents, eq(contents.id, contentVisits.contentId))
      .innerJoin(drawSpaces, eq(drawSpaces.id, contents.spaceId))
      .where(and(eq(contentVisits.memberId, memberId), isNull(contents.deletedAt), isNull(drawSpaces.deletedAt)))
      .orderBy(desc(contentVisits.visitedAt))
      .limit(limit)
  }

  /** The space's whole tree, siblings in their order (5.1). */
  async tree(spaceId: string): Promise<ContentRow[]> {
    return await this.db
      .select()
      .from(contents)
      .where(and(eq(contents.spaceId, spaceId), isNull(contents.deletedAt)))
      .orderBy(asc(contents.position))
  }

  async find(organizationId: string, id: string): Promise<ContentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(contents)
      .where(and(eq(contents.organizationId, organizationId), eq(contents.id, id), isNull(contents.deletedAt)))
    return row
  }

  /** A page by id alone, deleted or not — for the realtime handler, which already holds a ticket. */
  async byId(id: string): Promise<ContentRow | undefined> {
    const [row] = await this.db.select().from(contents).where(eq(contents.id, id))
    return row
  }

  /** The page's stored document, its row locked until the transaction ends (ADR-0009). */
  async lockDocument(tx: Database, contentId: string): Promise<string> {
    const [row] = await tx
      .select({ document: contents.document })
      .from(contents)
      .where(eq(contents.id, contentId))
      .for('update')
    return row?.document ?? ''
  }

  /** Not `update`: folding changes in is no edit, so it moves neither `updatedAt` nor `updatedBy`. */
  async writeDocument(tx: Database, contentId: string, document: string): Promise<void> {
    await tx.update(contents).set({ document }).where(eq(contents.id, contentId))
  }

  /** The positions under a parent, first to last, without the page being moved. */
  async positions(spaceId: string, parentId: string | null, except?: string) {
    const rows = await this.db
      .select({ id: contents.id, rank: contents.position })
      .from(contents)
      .where(and(_siblings(spaceId, parentId), except ? ne(contents.id, except) : undefined))
      .orderBy(asc(contents.position))
    return rows
  }

  async childCount(contentId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(contents)
      .where(and(eq(contents.parentId, contentId), isNull(contents.deletedAt)))
    return row?.total ?? 0
  }

  async insert(tx: Database, row: ContentRow): Promise<void> {
    await tx.insert(contents).values(row)
  }

  async update(tx: Database, id: string, fields: ContentFields, at: Date): Promise<void> {
    await tx
      .update(contents)
      .set({ ...fields, updatedAt: at })
      .where(eq(contents.id, id))
  }

  async renumber(tx: Database, ids: readonly string[]): Promise<void> {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(contents)
        .set({ position: index + 1 })
        .where(eq(contents.id, id))
    }
  }

  /** The Yjs updates not yet merged into the page's document (ADR-0009). */
  async updates(contentId: string): Promise<{ id: string; update: string }[]> {
    return await this.db
      .select({ id: contentUpdates.id, update: contentUpdates.update })
      .from(contentUpdates)
      .where(eq(contentUpdates.contentId, contentId))
      .orderBy(asc(contentUpdates.createdAt))
  }

  async appendUpdate(tx: Database, row: typeof contentUpdates.$inferInsert): Promise<void> {
    await tx.insert(contentUpdates).values(row)
  }

  async dropUpdates(tx: Database, ids: readonly string[]): Promise<void> {
    if (ids.length > 0) {
      await tx.delete(contentUpdates).where(inArray(contentUpdates.id, [...ids]))
    }
  }
}
