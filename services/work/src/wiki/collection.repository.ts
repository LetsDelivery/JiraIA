import type { Database } from '@jiraia/db'
import { and, eq, inArray, isNull, lt, ne, type SQL, sql } from 'drizzle-orm'

import { contents, drawSpaceGroupRoles, drawSpaceMembers, groupMembers, groups, members } from '../schema.js'
import { wikiCollections, wikiPages } from '../schema-wiki.js'
import type { CollectionRow, CollectionStats, Person } from './collection.schemas.js'

export type CollectionFields = Partial<Pick<CollectionRow, 'reviewDays' | 'outline' | 'access'>>

/** `count(*) filter (where …)` as an int: the condition keeps its parameters typed for the Data API. */
const countWhere = (condition: SQL | undefined) => sql<number>`(count(*) filter (where ${condition}))::int`

/** What a wiki collection adds to its space (ADR-0033, ADR-0034); the space itself is `DrawSpaceRepository`'s. */
export class CollectionRepository {
  constructor(private readonly db: Database) {}

  async find(spaceId: string): Promise<CollectionRow | undefined> {
    const [row] = await this.db.select().from(wikiCollections).where(eq(wikiCollections.spaceId, spaceId))
    return row
  }

  /** The member's personal collection, if they have one yet. */
  async personalOf(memberId: string): Promise<CollectionRow | undefined> {
    const [row] = await this.db.select().from(wikiCollections).where(eq(wikiCollections.ownerId, memberId))
    return row
  }

  async many(spaceIds: readonly string[]): Promise<Map<string, CollectionRow>> {
    if (spaceIds.length === 0) {
      return new Map()
    }
    const rows = await this.db
      .select()
      .from(wikiCollections)
      .where(inArray(wikiCollections.spaceId, [...spaceIds]))
    return new Map(rows.map((row) => [row.spaceId, row]))
  }

  async insert(tx: Database, row: CollectionRow): Promise<void> {
    await tx.insert(wikiCollections).values(row)
  }

  async update(tx: Database, spaceId: string, fields: CollectionFields): Promise<void> {
    if (Object.keys(fields).length > 0) {
      await tx.update(wikiCollections).set(fields).where(eq(wikiCollections.spaceId, spaceId))
    }
  }

  /** Pages, official pages and overdue ones per collection, counting neither folders nor the deleted. */
  async pageCounts(spaceIds: readonly string[], now: Date): Promise<Map<string, Omit<CollectionStats, 'people'>>> {
    if (spaceIds.length === 0) {
      return new Map()
    }
    const official = eq(wikiPages.state, 'official')
    const rows = await this.db
      .select({
        spaceId: contents.spaceId,
        pages: sql<number>`count(*)::int`,
        official: countWhere(official),
        overdue: countWhere(and(official, lt(wikiPages.reviewDue, now)))
      })
      .from(contents)
      .leftJoin(wikiPages, eq(wikiPages.contentId, contents.id))
      .where(and(inArray(contents.spaceId, [...spaceIds]), isNull(contents.deletedAt), ne(contents.kind, 'folder')))
      .groupBy(contents.spaceId)
    return new Map(rows.map(({ spaceId, ...counts }) => [spaceId, counts]))
  }

  /** Who holds the admin role directly in each collection: its owners, by name. */
  async owners(spaceIds: readonly string[]): Promise<Map<string, Person[]>> {
    if (spaceIds.length === 0) {
      return new Map()
    }
    const rows = await this.db
      .select({ spaceId: drawSpaceMembers.spaceId, id: members.id, name: members.name })
      .from(drawSpaceMembers)
      .innerJoin(members, eq(members.id, drawSpaceMembers.memberId))
      .where(and(inArray(drawSpaceMembers.spaceId, [...spaceIds]), eq(drawSpaceMembers.role, 'admin')))
      .orderBy(drawSpaceMembers.createdAt)
    const owners = new Map<string, Person[]>()
    for (const { spaceId, ...person } of rows) {
      owners.set(spaceId, [...(owners.get(spaceId) ?? []), person])
    }
    return owners
  }

  /** How many different people hold a role in each collection, directly or through a group. */
  async peopleCounts(spaceIds: readonly string[]): Promise<Map<string, number>> {
    if (spaceIds.length === 0) {
      return new Map()
    }
    const ids = [...spaceIds]
    const [direct, viaGroups] = await Promise.all([
      this.db
        .select({ spaceId: drawSpaceMembers.spaceId, memberId: drawSpaceMembers.memberId })
        .from(drawSpaceMembers)
        .where(inArray(drawSpaceMembers.spaceId, ids)),
      this.db
        .select({ spaceId: drawSpaceGroupRoles.spaceId, memberId: groupMembers.memberId })
        .from(drawSpaceGroupRoles)
        .innerJoin(groups, eq(groups.id, drawSpaceGroupRoles.groupId))
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .where(and(inArray(drawSpaceGroupRoles.spaceId, ids), isNull(groups.deletedAt)))
    ])
    const people = new Map<string, Set<string>>()
    for (const { spaceId, memberId } of [...direct, ...viaGroups]) {
      people.set(spaceId, (people.get(spaceId) ?? new Set()).add(memberId))
    }
    return new Map([...people].map(([spaceId, set]) => [spaceId, set.size]))
  }
}
