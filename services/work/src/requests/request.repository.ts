import type { Database } from '@jiraia/db'
import { and, desc, eq, type SQL, sql } from 'drizzle-orm'

import type { Product } from '../access.js'
import { accessRequests, drawSpaces, members, spaces } from '../schema.js'
import type { AccessRequestRead, AccessRequestRow } from './request.schemas.js'

export class AccessRequestRepository {
  constructor(private readonly db: Database) {}

  async find(organizationId: string, id: string): Promise<AccessRequestRead | undefined> {
    const [row] = await this._read(and(eq(accessRequests.organizationId, organizationId), eq(accessRequests.id, id)))
    return row
  }

  async pendingOf(product: Product, spaceId: string, memberId: string): Promise<AccessRequestRead | undefined> {
    const [row] = await this._read(
      and(_onSpace(product, spaceId), eq(accessRequests.memberId, memberId), eq(accessRequests.status, 'pending'))
    )
    return row
  }

  async pendingOn(product: Product, spaceId: string): Promise<AccessRequestRead[]> {
    return await this._read(and(_onSpace(product, spaceId), eq(accessRequests.status, 'pending')))
  }

  async mine(memberId: string): Promise<AccessRequestRead[]> {
    return await this._read(eq(accessRequests.memberId, memberId))
  }

  async insert(tx: Database, row: AccessRequestRow): Promise<void> {
    await tx.insert(accessRequests).values(row)
  }

  async decide(tx: Database, id: string, decision: Pick<AccessRequestRow, 'status' | 'decidedBy' | 'decidedAt'>) {
    await tx.update(accessRequests).set(decision).where(eq(accessRequests.id, id))
  }

  /** The requests with who asked and the space's name, whichever product it belongs to; newest first. */
  private async _read(where: SQL | undefined): Promise<AccessRequestRead[]> {
    return await this.db
      .select({
        request: accessRequests,
        memberName: members.name,
        memberEmail: members.email,
        spaceName: sql<string | null>`coalesce(${spaces.name}, ${drawSpaces.name})`
      })
      .from(accessRequests)
      .innerJoin(members, eq(members.id, accessRequests.memberId))
      .leftJoin(spaces, and(eq(accessRequests.product, 'jiraia'), eq(spaces.id, accessRequests.spaceId)))
      .leftJoin(drawSpaces, and(eq(accessRequests.product, 'draw'), eq(drawSpaces.id, accessRequests.spaceId)))
      .where(where)
      .orderBy(desc(accessRequests.createdAt))
      .limit(200)
      .then((rows) => rows.map(({ request, ...names }) => ({ ...request, ...names })))
  }
}

const _onSpace = (product: Product, spaceId: string) =>
  and(eq(accessRequests.product, product), eq(accessRequests.spaceId, spaceId))
