import type { Database } from '@jiraia/db'
import { and, desc, eq, gt, inArray, isNull, notExists, or, sql } from 'drizzle-orm'

import { cardComments, cards, members, spaces, workflowStates } from '../schema.js'
import { notifications } from '../schema-intake.js'

/** How many rows a list reads at most: the e-mail shows a few and counts up to this. */
const CAP = 50

/** A mention nobody answered, with what the e-mail shows of it. */
export type WaitingMention = {
  actorId: string
  actorName: string
  createdAt: Date
  data: unknown
}

/** A card nobody holds, still to do or in progress. */
export type OpenCard = { key: string; number: number; title: string; spaceName: string }

/** What Monday's summary reads (Etapa 5f): unanswered mentions and cards nobody took. */
export class WeeklyRepository {
  constructor(private readonly db: Database) {}

  /**
   * The member's mentions since `since` that they have not answered — no comment of theirs on the
   * card after it — and have not archived, newest first.
   */
  async mentionsWaiting(memberId: string, since: Date): Promise<WaitingMention[]> {
    const answered = this.db
      .select({ one: sql`1` })
      .from(cardComments)
      .where(
        and(
          eq(cardComments.cardId, notifications.cardId),
          eq(cardComments.authorId, notifications.memberId),
          gt(cardComments.createdAt, notifications.createdAt)
        )
      )
    return await this.db
      .select({
        actorId: notifications.actorId,
        actorName: members.name,
        createdAt: notifications.createdAt,
        data: notifications.data
      })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.actorId))
      .where(
        and(
          eq(notifications.memberId, memberId),
          eq(notifications.kind, 'mentioned'),
          gt(notifications.createdAt, since),
          isNull(notifications.archivedAt),
          notExists(answered)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(CAP)
  }

  /** The spaces the member worked in since `since`: cards they hold or opened, and cards they commented. */
  async spacesWorked(memberId: string, since: Date): Promise<string[]> {
    const own = await this.db
      .selectDistinct({ spaceId: cards.spaceId })
      .from(cards)
      .where(and(or(eq(cards.assigneeId, memberId), eq(cards.reporterId, memberId)), gt(cards.updatedAt, since)))
    const commented = await this.db
      .selectDistinct({ spaceId: cards.spaceId })
      .from(cardComments)
      .innerJoin(cards, eq(cards.id, cardComments.cardId))
      .where(and(eq(cardComments.authorId, memberId), gt(cardComments.createdAt, since)))
    return [...new Set([...own, ...commented].map((row) => row.spaceId))]
  }

  /** Cards in those spaces with nobody holding them, not done nor cancelled, newest first. */
  async openCards(spaceIds: readonly string[]): Promise<OpenCard[]> {
    if (spaceIds.length === 0) {
      return []
    }
    return await this.db
      .select({ key: spaces.key, number: cards.number, title: cards.title, spaceName: spaces.name })
      .from(cards)
      .innerJoin(spaces, eq(spaces.id, cards.spaceId))
      .innerJoin(workflowStates, eq(workflowStates.id, cards.stateId))
      .where(
        and(
          inArray(cards.spaceId, [...spaceIds]),
          isNull(cards.assigneeId),
          isNull(spaces.archivedAt),
          inArray(workflowStates.group, ['not_started', 'in_progress'])
        )
      )
      .orderBy(desc(cards.createdAt))
      .limit(CAP)
  }
}
