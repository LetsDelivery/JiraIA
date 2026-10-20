import type { Database } from '@jiraia/db'
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'

import { members, savedViews } from '../schema.js'
import type { SavedViewRow, ViewWithOwner } from './view.schemas.js'

export type ViewFields = Partial<Pick<SavedViewRow, 'name' | 'filter' | 'order' | 'layout' | 'lanes' | 'columns'>>

export type VisibleScope = {
  organizationId: string
  ownerId: string
  /** The spaces the member reads; `all` for an organization admin. */
  readable: readonly string[] | 'all'
  spaceId?: string | undefined
}

const _shared = (spaceIds: readonly string[] | 'all'): SQL | undefined => {
  if (spaceIds === 'all') {
    return eq(savedViews.scope, 'space')
  }
  return spaceIds.length ? and(eq(savedViews.scope, 'space'), inArray(savedViews.spaceId, [...spaceIds])) : undefined
}

export class ViewRepository {
  constructor(private readonly db: Database) {}

  private async _rows(where: SQL | undefined): Promise<ViewWithOwner[]> {
    const rows = await this.db
      .select({ view: savedViews, ownerName: members.name })
      .from(savedViews)
      .innerJoin(members, eq(members.id, savedViews.ownerId))
      .where(where)
      .orderBy(asc(savedViews.name))

    return rows.map((row) => ({ ...row.view, ownerName: row.ownerName }))
  }

  async find(organizationId: string, id: string): Promise<ViewWithOwner | undefined> {
    const [row] = await this._rows(and(eq(savedViews.organizationId, organizationId), eq(savedViews.id, id)))
    return row
  }

  /**
   * The views a member may see: their personal ones, and those of the spaces they read. With a space,
   * only that space's — and the member's personal views that are listed in no space.
   */
  async visible(scope: VisibleScope): Promise<ViewWithOwner[]> {
    const mine = and(
      eq(savedViews.scope, 'personal'),
      eq(savedViews.ownerId, scope.ownerId),
      scope.spaceId ? or(eq(savedViews.spaceId, scope.spaceId), isNull(savedViews.spaceId)) : undefined
    )
    const shared = _shared(scope.spaceId ? [scope.spaceId] : scope.readable)
    return await this._rows(and(eq(savedViews.organizationId, scope.organizationId), or(mine, shared)))
  }

  async insert(tx: Database, row: SavedViewRow): Promise<void> {
    await tx.insert(savedViews).values(row)
  }

  async update(tx: Database, id: string, fields: ViewFields, at: Date): Promise<void> {
    await tx
      .update(savedViews)
      .set({ ...fields, updatedAt: at })
      .where(eq(savedViews.id, id))
  }

  async remove(tx: Database, id: string): Promise<void> {
    await tx.delete(savedViews).where(eq(savedViews.id, id))
  }
}
