import type { Database } from '@jiraia/db'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { apiTokens } from '../schema-intake.js'
import type { ApiTokenRow } from './schemas.js'

export class TokenRepository {
  constructor(private readonly db: Database) {}

  async insert(tx: Database, row: ApiTokenRow): Promise<void> {
    await tx.insert(apiTokens).values(row)
  }

  async byHash(hash: string): Promise<ApiTokenRow | undefined> {
    const [row] = await this.db.select().from(apiTokens).where(eq(apiTokens.hash, hash))
    return row
  }

  async find(organizationId: string, id: string): Promise<ApiTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.organizationId, organizationId), eq(apiTokens.id, id)))
    return row
  }

  async ofMembers(memberIds: readonly string[]): Promise<ApiTokenRow[]> {
    if (memberIds.length === 0) {
      return []
    }
    return await this.db
      .select()
      .from(apiTokens)
      .where(inArray(apiTokens.memberId, [...memberIds]))
      .orderBy(desc(apiTokens.createdAt))
  }

  async revoke(tx: Database, id: string, at: Date): Promise<void> {
    await tx.update(apiTokens).set({ revokedAt: at }).where(eq(apiTokens.id, id))
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db.update(apiTokens).set({ lastUsedAt: at }).where(eq(apiTokens.id, id))
  }
}
