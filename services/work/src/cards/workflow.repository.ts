import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { and, asc, count, eq, type SQLWrapper, sql } from 'drizzle-orm'

import { cards, cardTypes, customFields, savedViews, workflowStates } from '../schema.js'
import { automations, forms } from '../schema-intake.js'
import { lookOf, swapId, type TypeColor, type TypeIcon } from './card-type.schemas.js'
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
    await tx.insert(cardTypes).values(
      template.types.map((name, position) => ({
        id: ids.next(),
        spaceId,
        name,
        ...lookOf(name),
        position,
        createdAt: at
      }))
    )
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

  async insertType(tx: Database, row: CardTypeRow): Promise<void> {
    await tx.insert(cardTypes).values(row)
  }

  async updateType(tx: Database, id: string, fields: { name?: string; icon?: TypeIcon; color?: TypeColor }) {
    await tx.update(cardTypes).set(fields).where(eq(cardTypes.id, id))
  }

  /** The order types are offered in: the position of each is its index in `typeIds`. */
  async setTypeOrder(tx: Database, typeIds: readonly string[]): Promise<void> {
    for (const [position, id] of typeIds.entries()) {
      await tx.update(cardTypes).set({ position }).where(eq(cardTypes.id, id))
    }
  }

  async deleteType(tx: Database, id: string): Promise<void> {
    await tx.delete(cardTypes).where(eq(cardTypes.id, id))
  }

  /**
   * Everything of type `from` becomes of type `to`: its cards and forms, and the fields, automations
   * and saved views that name it — so nothing points at a type that is gone (ADR-0031).
   */
  async replaceType(tx: Database, from: string, to: string): Promise<void> {
    await tx.update(cards).set({ typeId: to }).where(eq(cards.typeId, from))
    await tx.update(forms).set({ typeId: to }).where(eq(forms.typeId, from))
    await this._swapInFields(tx, from, to)
    await this._swapInRules(tx, from, to)
    await this._swapInViews(tx, from, to)
  }

  private async _swapInFields(tx: Database, from: string, to: string): Promise<void> {
    for (const field of await tx.select().from(customFields).where(naming(customFields.typeIds, from))) {
      await tx
        .update(customFields)
        .set({ typeIds: swapId(field.typeIds, from, to) })
        .where(eq(customFields.id, field.id))
    }
  }

  private async _swapInRules(tx: Database, from: string, to: string): Promise<void> {
    const parts = sql`(${automations.conditions} || ${automations.actions})`
    for (const rule of await tx.select().from(automations).where(naming(parts, from))) {
      const changes = { conditions: swapId(rule.conditions, from, to), actions: swapId(rule.actions, from, to) }
      await tx.update(automations).set(changes).where(eq(automations.id, rule.id))
    }
  }

  private async _swapInViews(tx: Database, from: string, to: string): Promise<void> {
    for (const view of await tx.select().from(savedViews).where(naming(savedViews.filter, from))) {
      await tx
        .update(savedViews)
        .set({ filter: swapId(view.filter, from, to) })
        .where(eq(savedViews.id, view.id))
    }
  }
}

/** JSON that names `id` somewhere: a uuid does not occur by chance, so a text match is enough. */
const naming = (column: SQLWrapper, id: string) => sql`${column}::text like ${`%${id}%`}`
