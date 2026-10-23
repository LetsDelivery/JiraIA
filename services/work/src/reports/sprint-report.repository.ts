import type { Database } from '@jiraia/db'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'

import { auditEvents, cards, workflowStates } from '../schema.js'
import type { CardChange, CardNow } from './burndown.js'

/** The changes a burndown reads: where a card was, in which state, for how many points. */
const READ = ['sprintId', 'stateId', 'points']

/**
 * The reads behind a sprint's burndown (ADR-0029): every card that was ever in the sprint, as it is
 * now and as its history changed it.
 */
export class SprintReportRepository {
  constructor(private readonly db: Database) {}

  /** Cards in the sprint now, and cards whose history says they were in it at some point. */
  async cardsEverIn(spaceId: string, sprintId: string): Promise<CardNow[]> {
    const touched = this.db
      .selectDistinct({ id: auditEvents.entityId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.spaceId, spaceId),
          eq(auditEvents.entityType, 'card'),
          or(
            sql`${auditEvents.changes} -> 'sprintId' ->> 'before' = ${sprintId}`,
            sql`${auditEvents.changes} -> 'sprintId' ->> 'after' = ${sprintId}`
          )
        )
      )
    return await this.db
      .select({ id: cards.id, sprintId: cards.sprintId, stateId: cards.stateId, points: cards.points })
      .from(cards)
      .where(and(eq(cards.spaceId, spaceId), or(eq(cards.sprintId, sprintId), inArray(cards.id, touched))))
  }

  /** The history of those cards that touched their sprint, state or points, oldest first. */
  async changesOf(cardIds: readonly string[]): Promise<CardChange[]> {
    if (cardIds.length === 0) {
      return []
    }
    const rows = await this.db
      .select({ cardId: auditEvents.entityId, at: auditEvents.occurredAt, changes: auditEvents.changes })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'card'), inArray(auditEvents.entityId, [...cardIds])))
      .orderBy(asc(auditEvents.occurredAt))
    return rows
      .map((row) => ({ ...row, changes: row.changes as CardChange['changes'] }))
      .filter((row) => READ.some((field) => field in row.changes))
  }

  /** Each state of the space and its group. */
  async groups(spaceId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: workflowStates.id, group: workflowStates.group })
      .from(workflowStates)
      .where(eq(workflowStates.spaceId, spaceId))
    return new Map(rows.map((row) => [row.id, row.group]))
  }
}
