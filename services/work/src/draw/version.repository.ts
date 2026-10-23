import type { Database } from '@jiraia/db'
import { and, desc, eq, getTableColumns, gt, inArray, max } from 'drizzle-orm'

import { contentVersions, members } from '../schema.js'
import type { NewVersionRow, VersionRow, VersionWithAuthor } from './content.schemas.js'

/** A version's columns but its Yjs copy, which is only ever written (ADR-0009). */
const { document: _document, ...versionColumns } = getTableColumns(contentVersions)

/** A page's versions (5.4), newest first. */
export class VersionRepository {
  constructor(private readonly db: Database) {}

  private _select() {
    return this.db
      .select({ version: versionColumns, authorName: members.name })
      .from(contentVersions)
      .innerJoin(members, eq(members.id, contentVersions.createdBy))
  }

  async list(contentId: string): Promise<VersionWithAuthor[]> {
    const rows = await this._select()
      .where(eq(contentVersions.contentId, contentId))
      .orderBy(desc(contentVersions.number))
    return rows.map((row) => ({ ...row.version, authorName: row.authorName }))
  }

  async find(contentId: string, number: number): Promise<VersionWithAuthor | undefined> {
    const [row] = await this._select().where(
      and(eq(contentVersions.contentId, contentId), eq(contentVersions.number, number))
    )
    return row ? { ...row.version, authorName: row.authorName } : undefined
  }

  async latest(contentId: string): Promise<VersionRow | undefined> {
    const [row] = await this.db
      .select(versionColumns)
      .from(contentVersions)
      .where(eq(contentVersions.contentId, contentId))
      .orderBy(desc(contentVersions.number))
      .limit(1)
    return row
  }

  /** Everyone who saved a version of the content: the people who helped write it (Etapa 5f). */
  async authors(contentId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ memberId: contentVersions.createdBy })
      .from(contentVersions)
      .where(eq(contentVersions.contentId, contentId))
    return rows.map((row) => row.memberId)
  }

  /** Who saved a version of each content after `since`, by name — the morning summary's "fez alterações". */
  async editorsSince(
    contentIds: readonly string[],
    since: Date
  ): Promise<{ contentId: string; memberId: string; name: string }[]> {
    if (contentIds.length === 0) {
      return []
    }
    return await this.db
      .selectDistinct({ contentId: contentVersions.contentId, memberId: members.id, name: members.name })
      .from(contentVersions)
      .innerJoin(members, eq(members.id, contentVersions.createdBy))
      .where(and(inArray(contentVersions.contentId, [...contentIds]), gt(contentVersions.createdAt, since)))
  }

  /** The next number, read inside the writing transaction; the unique index catches a race. */
  async nextNumber(tx: Database, contentId: string): Promise<number> {
    const [row] = await tx
      .select({ top: max(contentVersions.number) })
      .from(contentVersions)
      .where(eq(contentVersions.contentId, contentId))
    return (row?.top ?? 0) + 1
  }

  async insert(tx: Database, row: NewVersionRow): Promise<void> {
    await tx.insert(contentVersions).values(row)
  }
}
