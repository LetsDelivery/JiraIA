import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, inArray, isNull, lt, max } from 'drizzle-orm'

import { cards, sprints, workflowStates } from '../schema.js'
import type { SprintRow, SprintState } from './schemas.js'

/** A card of a sprint, with what a close needs of it: its state group and its points. */
export type SprintCard = { id: string; group: string; points: number | null }

export type SprintFields = Partial<Omit<SprintRow, 'id' | 'organizationId' | 'spaceId' | 'number' | 'createdAt'>>

export class SprintRepository {
  constructor(private readonly db: Database) {}

  /** A space's sprints, oldest number first. */
  async list(spaceId: string, state?: SprintState): Promise<SprintRow[]> {
    return await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.spaceId, spaceId), state ? eq(sprints.state, state) : undefined))
      .orderBy(asc(sprints.number))
  }

  async find(organizationId: string, id: string): Promise<SprintRow | undefined> {
    const [row] = await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.organizationId, organizationId), eq(sprints.id, id)))
    return row
  }

  /** The highest-numbered sprint of the space: the one a new sprint follows. */
  async last(spaceId: string): Promise<SprintRow | undefined> {
    const [row] = await this.db
      .select()
      .from(sprints)
      .where(eq(sprints.spaceId, spaceId))
      .orderBy(desc(sprints.number))
      .limit(1)
    return row
  }

  /** The next number, read inside the writing transaction; the unique index catches a race. */
  async nextNumber(tx: Database, spaceId: string): Promise<number> {
    const [row] = await tx
      .select({ top: max(sprints.number) })
      .from(sprints)
      .where(eq(sprints.spaceId, spaceId))
    return (row?.top ?? 0) + 1
  }

  async insert(tx: Database, row: SprintRow): Promise<void> {
    await tx.insert(sprints).values(row)
  }

  async update(tx: Database, id: string, fields: SprintFields): Promise<void> {
    await tx.update(sprints).set(fields).where(eq(sprints.id, id))
  }

  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(sprints).where(eq(sprints.id, id))
  }

  /** The cards in a sprint, each with its state's group. */
  async cardsOf(sprintId: string, tx: Database = this.db): Promise<SprintCard[]> {
    return await tx
      .select({ id: cards.id, group: workflowStates.group, points: cards.points })
      .from(cards)
      .innerJoin(workflowStates, eq(workflowStates.id, cards.stateId))
      .where(eq(cards.sprintId, sprintId))
  }

  /** Moves cards to another sprint — or to the backlog, with `null`. */
  async moveCards(tx: Database, cardIds: readonly string[], sprintId: string | null, at: Date): Promise<void> {
    if (cardIds.length > 0) {
      await tx
        .update(cards)
        .set({ sprintId, updatedAt: at })
        .where(inArray(cards.id, [...cardIds]))
    }
  }

  /** Active sprints whose end date is before `today` and whose lead has not been told yet. */
  async late(today: string): Promise<SprintRow[]> {
    return await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.state, 'active'), lt(sprints.endsOn, today), isNull(sprints.lateNoticeAt)))
  }
}
