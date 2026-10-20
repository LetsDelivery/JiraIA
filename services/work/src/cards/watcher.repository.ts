import type { Database } from '@jiraia/db'
import { and, asc, eq } from 'drizzle-orm'

import { cardWatchers, members } from '../schema.js'

/** Who follows which card (2.11). */
export class WatcherRepository {
  constructor(private readonly db: Database) {}

  async list(cardId: string): Promise<{ id: string; name: string }[]> {
    return await this.db
      .select({ id: members.id, name: members.name })
      .from(cardWatchers)
      .innerJoin(members, eq(members.id, cardWatchers.memberId))
      .where(eq(cardWatchers.cardId, cardId))
      .orderBy(asc(cardWatchers.createdAt))
  }

  /** Idempotent: following a card twice is following it. Takes the transaction of the write that caused it. */
  async add(tx: Database, cardId: string, memberIds: readonly string[], at: Date): Promise<void> {
    if (memberIds.length === 0) {
      return
    }
    await tx
      .insert(cardWatchers)
      .values([...new Set(memberIds)].map((memberId) => ({ cardId, memberId, createdAt: at })))
      .onConflictDoNothing()
  }

  async remove(cardId: string, memberId: string): Promise<void> {
    await this.db.delete(cardWatchers).where(and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.memberId, memberId)))
  }
}
