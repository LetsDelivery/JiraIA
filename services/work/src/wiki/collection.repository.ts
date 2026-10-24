import type { Database } from '@jiraia/db'
import { eq, inArray } from 'drizzle-orm'

import { wikiCollections } from '../schema-wiki.js'
import type { CollectionRow } from './collection.schemas.js'

export type CollectionFields = Partial<Pick<CollectionRow, 'reviewDays' | 'outline'>>

/** What a wiki collection adds to its space (ADR-0033); the space itself is `DrawSpaceRepository`'s. */
export class CollectionRepository {
  constructor(private readonly db: Database) {}

  async find(spaceId: string): Promise<CollectionRow | undefined> {
    const [row] = await this.db.select().from(wikiCollections).where(eq(wikiCollections.spaceId, spaceId))
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
}
