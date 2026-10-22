import type { Database } from '@jiraia/db'
import { and, asc, count, desc, eq, getTableColumns, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { contents, contentUpdates, drawSpaces } from '../schema.js'
import { contentVisits } from '../schema-intake.js'
import type { ContentRow, NewContentRow } from './content.schemas.js'

export type ContentFields = Partial<
  Pick<ContentRow, 'title' | 'parentId' | 'position' | 'contentJson' | 'contentText' | 'updatedBy' | 'deletedAt'>
>

/** A content's columns but its Yjs `document`, read apart (ADR-0009). */
const { document: _document, ...contentColumns } = getTableColumns(contents)

/**
 * How much text one read brings back: well under the Data API's 1 MiB answer (ADR-0002), so a document
 * or a run of updates of any size is read in several statements instead of failing in one.
 */
export const PIECE = 500_000

/**
 * One piece of a long text column, from the 1-based character `from`. The Data API binds a JS number
 * as a `bigint`, and Postgres has no `substr(text, bigint, bigint)`, so both are cast to `int`.
 */
export const pieceOf = (column: AnyPgColumn, from: number): SQL<string> =>
  sql<string>`substr(${column}, ${from}::int, ${PIECE}::int)`

/** Consecutive updates whose sizes add up to at most `PIECE`; one larger than that stands alone. */
export const batchUnder = <T extends { length: number }>(items: readonly T[], limit = PIECE): T[][] => {
  const batches: T[][] = []
  let size = 0
  for (const item of items) {
    const last = batches.at(-1)
    if (last && size + item.length <= limit) {
      last.push(item)
      size += item.length
    } else {
      batches.push([item])
      size = item.length
    }
  }
  return batches
}

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
      .select({ content: contentColumns, spaceName: drawSpaces.name, spaceIcon: drawSpaces.icon })
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
      .select({ content: contentColumns, spaceName: drawSpaces.name, spaceIcon: drawSpaces.icon })
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
      .select(contentColumns)
      .from(contents)
      .where(and(eq(contents.spaceId, spaceId), isNull(contents.deletedAt)))
      .orderBy(asc(contents.position))
  }

  async find(organizationId: string, id: string): Promise<ContentRow | undefined> {
    const [row] = await this.db
      .select(contentColumns)
      .from(contents)
      .where(and(eq(contents.organizationId, organizationId), eq(contents.id, id), isNull(contents.deletedAt)))
    return row
  }

  /** A page by id alone, deleted or not — for the realtime handler, which already holds a ticket. */
  async byId(id: string): Promise<ContentRow | undefined> {
    const [row] = await this.db.select(contentColumns).from(contents).where(eq(contents.id, id))
    return row
  }

  /** The page's stored document, read in pieces; with `tx`, its row locked until it ends (ADR-0009). */
  async document(contentId: string, tx?: Database): Promise<string> {
    const db = tx ?? this.db
    const length = await this._documentLength(db, contentId, tx !== undefined)
    let document = ''
    for (let from = 1; from <= length; from += PIECE) {
      const [piece] = await db
        .select({ text: pieceOf(contents.document, from) })
        .from(contents)
        .where(eq(contents.id, contentId))
      document += piece?.text ?? ''
    }
    return document
  }

  /** How long the stored document is, in base64 characters — what tells a bloated one apart. */
  async documentLength(contentId: string): Promise<number> {
    return await this._documentLength(this.db, contentId, false)
  }

  private async _documentLength(db: Database, contentId: string, lock: boolean): Promise<number> {
    const query = db
      .select({ length: sql<number>`length(${contents.document})` })
      .from(contents)
      .where(eq(contents.id, contentId))
    const [row] = lock ? await query.for('update') : await query
    return Number(row?.length ?? 0)
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

  async insert(tx: Database, row: NewContentRow): Promise<void> {
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

  /** The Yjs updates not yet merged into the page's document, in order, read in batches (ADR-0009). */
  async updates(contentId: string): Promise<{ id: string; update: string }[]> {
    const sizes = await this.db
      .select({ id: contentUpdates.id, length: sql<number>`length(${contentUpdates.update})` })
      .from(contentUpdates)
      .where(eq(contentUpdates.contentId, contentId))
      .orderBy(asc(contentUpdates.createdAt), asc(contentUpdates.id))
    const read: { id: string; update: string }[] = []
    for (const batch of batchUnder(sizes.map((each) => ({ id: each.id, length: Number(each.length) })))) {
      read.push(...(await this._updates(batch)))
    }
    return read
  }

  /** One batch, in the order asked; a lone update past `PIECE` is read in pieces. */
  private async _updates(batch: readonly { id: string; length: number }[]): Promise<{ id: string; update: string }[]> {
    const [only] = batch
    if (batch.length === 1 && only && only.length > PIECE) {
      return [{ id: only.id, update: await this._updateInPieces(only) }]
    }
    const rows = await this.db
      .select({ id: contentUpdates.id, update: contentUpdates.update })
      .from(contentUpdates)
      .where(
        inArray(
          contentUpdates.id,
          batch.map((each) => each.id)
        )
      )
    const byId = new Map(rows.map((row) => [row.id, row.update]))
    return batch.flatMap((each) => {
      const update = byId.get(each.id)
      return update === undefined ? [] : [{ id: each.id, update }]
    })
  }

  private async _updateInPieces({ id, length }: { id: string; length: number }): Promise<string> {
    let update = ''
    for (let from = 1; from <= length; from += PIECE) {
      const [piece] = await this.db
        .select({ text: pieceOf(contentUpdates.update, from) })
        .from(contentUpdates)
        .where(eq(contentUpdates.id, id))
      update += piece?.text ?? ''
    }
    return update
  }

  /** How many updates wait to be merged — counted, not read. */
  async pendingCount(contentId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(contentUpdates)
      .where(eq(contentUpdates.contentId, contentId))
    return row?.total ?? 0
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
