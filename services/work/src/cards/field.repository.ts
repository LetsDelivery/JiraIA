import type { Database } from '@jiraia/db'
import { and, asc, count, eq, sql } from 'drizzle-orm'

import { cards, customFields } from '../schema.js'
import type { FieldRow } from './field.schemas.js'

export class FieldRepository {
  constructor(private readonly db: Database) {}

  async list(spaceId: string): Promise<FieldRow[]> {
    return await this.db
      .select()
      .from(customFields)
      .where(eq(customFields.spaceId, spaceId))
      .orderBy(asc(customFields.position))
  }

  async find(spaceId: string, id: string): Promise<FieldRow | undefined> {
    const [row] = await this.db
      .select()
      .from(customFields)
      .where(and(eq(customFields.spaceId, spaceId), eq(customFields.id, id)))
    return row
  }

  async insert(tx: Database, row: FieldRow): Promise<void> {
    await tx.insert(customFields).values(row)
  }

  async update(tx: Database, id: string, fields: Partial<Pick<FieldRow, 'name' | 'options' | 'typeIds'>>) {
    await tx.update(customFields).set(fields).where(eq(customFields.id, id))
  }

  /** The field goes, and so does its value on every card of the space. */
  async delete(tx: Database, spaceId: string, id: string): Promise<void> {
    await tx
      .update(cards)
      .set({ customFields: sql`${cards.customFields} - ${id}::text` })
      .where(eq(cards.spaceId, spaceId))
    await tx.delete(customFields).where(eq(customFields.id, id))
  }

  /** How many cards hold `option` in a selection field — single (`"x"`) or multiple (`["x"]`). */
  async cardsChoosing(spaceId: string, fieldId: string, option: string): Promise<number> {
    const single = JSON.stringify({ [fieldId]: option })
    const multiple = JSON.stringify({ [fieldId]: [option] })
    const [row] = await this.db
      .select({ total: count() })
      .from(cards)
      .where(
        and(
          eq(cards.spaceId, spaceId),
          sql`(${cards.customFields} @> ${single}::jsonb or ${cards.customFields} @> ${multiple}::jsonb)`
        )
      )
    return row?.total ?? 0
  }
}
