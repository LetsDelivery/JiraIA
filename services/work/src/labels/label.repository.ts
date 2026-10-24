import type { Database } from '@jiraia/db'
import { and, asc, eq, sql } from 'drizzle-orm'

import { cards, labels } from '../schema.js'
import type { LabelRow } from './label.schemas.js'

/** A card carrying a label, with all its labels — what a rename or a removal rewrites. */
export type Carrier = { id: string; labels: string[] }

export class LabelRepository {
  constructor(private readonly db: Database) {}

  /** The space's labels by name, each with how many of its cards carry it. */
  async list(spaceId: string): Promise<(LabelRow & { cards: number })[]> {
    const carrying = sql<number>`(select count(*)::int from ${cards} where ${cards.spaceId} = ${labels.spaceId} and ${cards.labels} @> jsonb_build_array(${labels.name}))`
    return await this.db
      .select({
        id: labels.id,
        spaceId: labels.spaceId,
        name: labels.name,
        color: labels.color,
        createdAt: labels.createdAt,
        cards: carrying
      })
      .from(labels)
      .where(eq(labels.spaceId, spaceId))
      .orderBy(asc(sql`lower(${labels.name})`))
  }

  async find(spaceId: string, id: string): Promise<LabelRow | undefined> {
    const [row] = await this.db
      .select()
      .from(labels)
      .where(and(eq(labels.spaceId, spaceId), eq(labels.id, id)))
    return row
  }

  async findByName(spaceId: string, name: string): Promise<LabelRow | undefined> {
    const [row] = await this.db
      .select()
      .from(labels)
      .where(and(eq(labels.spaceId, spaceId), eq(labels.name, name)))
    return row
  }

  async insert(tx: Database, row: LabelRow): Promise<void> {
    await tx.insert(labels).values(row)
  }

  async update(tx: Database, id: string, fields: { name?: string; color?: string }): Promise<void> {
    await tx.update(labels).set(fields).where(eq(labels.id, id))
  }

  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(labels).where(eq(labels.id, id))
  }

  async carriers(spaceId: string, name: string): Promise<Carrier[]> {
    const rows = await this.db
      .select({ id: cards.id, labels: cards.labels })
      .from(cards)
      .where(and(eq(cards.spaceId, spaceId), sql`${cards.labels} @> jsonb_build_array(${name}::text)`))
    return rows.map((row) => ({ id: row.id, labels: row.labels as string[] }))
  }

  async setCardLabels(tx: Database, cardId: string, next: readonly string[], at: Date): Promise<void> {
    await tx
      .update(cards)
      .set({ labels: [...next], updatedAt: at })
      .where(eq(cards.id, cardId))
  }
}
