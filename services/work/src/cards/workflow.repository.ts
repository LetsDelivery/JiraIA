import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { and, asc, count, eq } from 'drizzle-orm'

import { cards, cardTypes, workflowStates } from '../schema.js'
import type { CardTypeRow, StateGroup, StateRow } from './schemas.js'
import type { WorkflowTemplate } from './workflow-defaults.js'

export class WorkflowRepository {
  constructor(private readonly db: Database) {}

  async states(spaceId: string): Promise<StateRow[]> {
    return await this.db
      .select()
      .from(workflowStates)
      .where(eq(workflowStates.spaceId, spaceId))
      .orderBy(asc(workflowStates.position))
  }

  async types(spaceId: string): Promise<CardTypeRow[]> {
    return await this.db.select().from(cardTypes).where(eq(cardTypes.spaceId, spaceId)).orderBy(asc(cardTypes.position))
  }

  /** A space's first workflow, written in the transaction that creates the space. */
  async insertTemplate(
    tx: Database,
    input: { spaceId: string; template: WorkflowTemplate; ids: IdGenerator; at: Date }
  ) {
    const { spaceId, template, ids, at } = input
    await tx.insert(workflowStates).values(
      template.states.map(([name, group], position) => ({
        id: ids.next(),
        spaceId,
        name,
        group,
        position,
        createdAt: at
      }))
    )
    await tx
      .insert(cardTypes)
      .values(template.types.map((name, position) => ({ id: ids.next(), spaceId, name, position, createdAt: at })))
  }

  async insertState(tx: Database, row: StateRow): Promise<void> {
    await tx.insert(workflowStates).values(row)
  }

  async updateState(tx: Database, id: string, fields: { name?: string; group?: StateGroup }): Promise<void> {
    await tx.update(workflowStates).set(fields).where(eq(workflowStates.id, id))
  }

  /** Board order: the position of each state is its index in `stateIds`. */
  async setOrder(tx: Database, stateIds: readonly string[]): Promise<void> {
    for (const [position, id] of stateIds.entries()) {
      await tx.update(workflowStates).set({ position }).where(eq(workflowStates.id, id))
    }
  }

  async deleteState(tx: Database, id: string): Promise<void> {
    await tx.delete(workflowStates).where(eq(workflowStates.id, id))
  }

  async cardsIn(stateId: string): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(cards).where(eq(cards.stateId, stateId))
    return row?.total ?? 0
  }

  async moveAllCards(tx: Database, from: string, to: string): Promise<void> {
    await tx.update(cards).set({ stateId: to }).where(eq(cards.stateId, from))
  }

  async findState(spaceId: string, id: string): Promise<StateRow | undefined> {
    const [row] = await this.db
      .select()
      .from(workflowStates)
      .where(and(eq(workflowStates.spaceId, spaceId), eq(workflowStates.id, id)))
    return row
  }

  async findType(spaceId: string, id: string): Promise<CardTypeRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cardTypes)
      .where(and(eq(cardTypes.spaceId, spaceId), eq(cardTypes.id, id)))
    return row
  }
}
