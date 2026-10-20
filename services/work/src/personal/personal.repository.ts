import type { Database } from '@jiraia/db'
import { and, desc, eq, gte, max, sql, sum } from 'drizzle-orm'

import { spaceStars, spaceVisits } from '../schema.js'

/** What one member did with spaces: their stars and their visits. Nobody else's. */
export class PersonalRepository {
  constructor(private readonly db: Database) {}

  async star(memberId: string, spaceId: string, at: Date): Promise<void> {
    await this.db.insert(spaceStars).values({ memberId, spaceId, createdAt: at }).onConflictDoNothing()
  }

  async unstar(memberId: string, spaceId: string): Promise<void> {
    await this.db.delete(spaceStars).where(and(eq(spaceStars.memberId, memberId), eq(spaceStars.spaceId, spaceId)))
  }

  async starredSpaceIds(memberId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ spaceId: spaceStars.spaceId })
      .from(spaceStars)
      .where(eq(spaceStars.memberId, memberId))

    return new Set(rows.map((row) => row.spaceId))
  }

  /** One more visit today (UTC). `day` is `YYYY-MM-DD`. */
  async recordVisit(input: { memberId: string; spaceId: string; day: string; at: Date }): Promise<void> {
    await this.db
      .insert(spaceVisits)
      .values({ ...input, count: 1, lastVisitedAt: input.at })
      .onConflictDoUpdate({
        target: [spaceVisits.memberId, spaceVisits.spaceId, spaceVisits.day],
        set: { count: sql`${spaceVisits.count} + 1`, lastVisitedAt: input.at }
      })
  }

  /** The last visit to each space, most recent first. */
  async lastVisits(memberId: string, limit: number): Promise<{ spaceId: string; lastVisitedAt: Date }[]> {
    const last = max(spaceVisits.lastVisitedAt)
    const rows = await this.db
      .select({ spaceId: spaceVisits.spaceId, lastVisitedAt: last })
      .from(spaceVisits)
      .where(eq(spaceVisits.memberId, memberId))
      .groupBy(spaceVisits.spaceId)
      .orderBy(desc(last))
      .limit(limit)

    return rows.flatMap((row) =>
      row.lastVisitedAt ? [{ spaceId: row.spaceId, lastVisitedAt: row.lastVisitedAt }] : []
    )
  }

  /** Visits per space since `sinceDay` (inclusive). */
  async visitCounts(memberId: string, sinceDay: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ spaceId: spaceVisits.spaceId, total: sum(spaceVisits.count).mapWith(Number) })
      .from(spaceVisits)
      .where(and(eq(spaceVisits.memberId, memberId), gte(spaceVisits.day, sinceDay)))
      .groupBy(spaceVisits.spaceId)

    return new Map(rows.map((row) => [row.spaceId, row.total]))
  }
}
