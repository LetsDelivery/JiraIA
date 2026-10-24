import type { Database } from '@jiraia/db'
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'

import { drawSpaceMarks, drawSpaceMembers, drawSpaces, members } from '../schema.js'
import type { DrawMark, DrawSpaceRow, DrawSpaceWithCreator } from './draw-space.schemas.js'

export type DrawSpaceFields = Partial<Pick<DrawSpaceRow, 'name' | 'description' | 'icon' | 'deletedAt'>>

export class DrawSpaceRepository {
  constructor(private readonly db: Database) {}

  private async _rows(where: SQL | undefined): Promise<DrawSpaceWithCreator[]> {
    const rows = await this.db
      .select({ space: drawSpaces, creatorName: members.name })
      .from(drawSpaces)
      .innerJoin(members, eq(members.id, drawSpaces.createdBy))
      .where(and(where, isNull(drawSpaces.deletedAt)))
      .orderBy(asc(drawSpaces.name))
    return rows.map((row) => ({ ...row.space, creatorName: row.creatorName }))
  }

  /** The organization's spaces of one product: Draw's, or the wiki's collections (ADR-0033). */
  async list(organizationId: string, area: DrawSpaceRow['area'] = 'draw'): Promise<DrawSpaceWithCreator[]> {
    return await this._rows(and(eq(drawSpaces.organizationId, organizationId), eq(drawSpaces.area, area)))
  }

  async find(organizationId: string, id: string): Promise<DrawSpaceWithCreator | undefined> {
    const [row] = await this._rows(and(eq(drawSpaces.organizationId, organizationId), eq(drawSpaces.id, id)))
    return row
  }

  async insert(tx: Database, row: DrawSpaceRow): Promise<void> {
    await tx.insert(drawSpaces).values(row)
  }

  /** Whoever creates a space holds it: its first admin (ADR-0012). */
  async addAdmin(tx: Database, spaceId: string, memberId: string, at: Date): Promise<void> {
    await tx.insert(drawSpaceMembers).values({ spaceId, memberId, role: 'admin', createdAt: at })
  }

  async update(tx: Database, id: string, fields: DrawSpaceFields, at: Date): Promise<void> {
    await tx
      .update(drawSpaces)
      .set({ ...fields, updatedAt: at })
      .where(eq(drawSpaces.id, id))
  }

  /** Each space's marks for one member: which they starred, which they follow. */
  async marksOf(memberId: string): Promise<Map<string, Set<DrawMark>>> {
    const rows = await this.db.select().from(drawSpaceMarks).where(eq(drawSpaceMarks.memberId, memberId))
    const marks = new Map<string, Set<DrawMark>>()
    for (const row of rows) {
      marks.set(row.spaceId, (marks.get(row.spaceId) ?? new Set()).add(row.mark as DrawMark))
    }
    return marks
  }

  async mark(row: typeof drawSpaceMarks.$inferInsert): Promise<void> {
    await this.db.insert(drawSpaceMarks).values(row).onConflictDoNothing()
  }

  async unmark(spaceId: string, memberId: string, mark: DrawMark): Promise<void> {
    await this.db
      .delete(drawSpaceMarks)
      .where(
        and(eq(drawSpaceMarks.spaceId, spaceId), eq(drawSpaceMarks.memberId, memberId), eq(drawSpaceMarks.mark, mark))
      )
  }
}
