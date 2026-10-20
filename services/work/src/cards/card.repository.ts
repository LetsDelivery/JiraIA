import type { Database } from '@jiraia/db'
import { and, asc, eq, inArray, max, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { cardKeyAliases, cards, groups, members, spaces } from '../schema.js'
import type { CardRow, CardWithPeople } from './schemas.js'

const assignee = alias(members, 'assignee')
const reporter = alias(members, 'reporter')

export type CardFields = Partial<
  Pick<
    CardRow,
    | 'title'
    | 'description'
    | 'typeId'
    | 'stateId'
    | 'assigneeId'
    | 'groupId'
    | 'priority'
    | 'labels'
    | 'dueDate'
    | 'estimate'
    | 'parentId'
    | 'customFields'
    | 'rank'
    | 'backlogRank'
    | 'spaceId'
    | 'number'
  >
>

export class CardRepository {
  constructor(private readonly db: Database) {}

  /** Cards with their space key and the names of the people on them, in board order unless told. */
  private async _rows(where: SQL | undefined, order: SQL[] = [asc(cards.rank)], limit?: number) {
    const query = this.db
      .select({
        card: cards,
        spaceKey: spaces.key,
        assigneeName: assignee.name,
        reporterName: reporter.name,
        groupName: groups.name
      })
      .from(cards)
      .innerJoin(spaces, eq(spaces.id, cards.spaceId))
      .innerJoin(reporter, eq(reporter.id, cards.reporterId))
      .leftJoin(assignee, eq(assignee.id, cards.assigneeId))
      .leftJoin(groups, eq(groups.id, cards.groupId))
      .where(where)
      .orderBy(...order)
      .$dynamic()
    const rows = await (limit === undefined ? query : query.limit(limit))

    return rows.map(
      (row): CardWithPeople => ({
        ...row.card,
        spaceKey: row.spaceKey,
        assigneeName: row.assigneeName,
        reporterName: row.reporterName,
        groupName: row.groupName
      })
    )
  }

  /** Every card of a space. */
  async list(spaceId: string): Promise<CardWithPeople[]> {
    return await this._rows(eq(cards.spaceId, spaceId))
  }

  /** Cards across spaces, for a filter built by `search/card-query.ts` (3.4). */
  async search(where: SQL | undefined, order: SQL[], limit: number): Promise<CardWithPeople[]> {
    return await this._rows(where, order, limit)
  }

  async find(organizationId: string, id: string): Promise<CardWithPeople | undefined> {
    const [row] = await this._rows(and(eq(cards.organizationId, organizationId), eq(cards.id, id)))
    return row
  }

  /** The next `KEY-n`, taken from the space's counter in the same transaction as the insert. */
  async nextNumber(tx: Database, spaceId: string): Promise<number> {
    const [row] = await tx
      .update(spaces)
      .set({ nextCardNumber: sql`${spaces.nextCardNumber} + 1` })
      .where(eq(spaces.id, spaceId))
      .returning({ next: spaces.nextCardNumber })

    return (row?.next ?? 1) - 1
  }

  /** The ranks of one state's cards, top to bottom, without the card being moved. */
  async column(stateId: string, except?: string): Promise<{ id: string; rank: number }[]> {
    const rows = await this.db
      .select({ id: cards.id, rank: cards.rank })
      .from(cards)
      .where(eq(cards.stateId, stateId))
      .orderBy(asc(cards.rank))

    return rows.filter((row) => row.id !== except)
  }

  async insert(tx: Database, row: CardRow): Promise<void> {
    await tx.insert(cards).values(row)
  }

  async update(tx: Database, id: string, fields: CardFields, at: Date): Promise<void> {
    await tx
      .update(cards)
      .set({ ...fields, updatedAt: at })
      .where(eq(cards.id, id))
  }

  /** Renumbers a column 1, 2, 3… when two neighbours got too close to split again. */
  async renumber(tx: Database, ids: readonly string[]): Promise<void> {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(cards)
        .set({ rank: index + 1 })
        .where(eq(cards.id, id))
    }
  }

  /** The last time anything happened to a card of the space — the list's "última atualização". */
  async touchSpace(tx: Database, spaceId: string, at: Date): Promise<void> {
    await tx.update(spaces).set({ lastCardActivityAt: at }).where(eq(spaces.id, spaceId))
  }

  /**
   * A card by the key people type — its current one, or one it answered to before it moved to another
   * space (2.14).
   *
   * @example await cards.findByKey(orgId, 'REQ-12')   // the card, even if it is PRD-40 now
   */
  async findByKey(organizationId: string, key: string): Promise<CardWithPeople | undefined> {
    const [spaceKey = '', digits = ''] = key.toUpperCase().split('-')
    const number = Number(digits)
    const [current] = await this._rows(
      and(eq(cards.organizationId, organizationId), eq(spaces.key, spaceKey), eq(cards.number, number))
    )
    if (current) {
      return current
    }
    const [alias] = await this.db
      .select({ cardId: cardKeyAliases.cardId })
      .from(cardKeyAliases)
      .where(
        and(
          eq(cardKeyAliases.organizationId, organizationId),
          eq(cardKeyAliases.spaceKey, spaceKey),
          eq(cardKeyAliases.number, number)
        )
      )
    return alias ? await this.find(organizationId, alias.cardId) : undefined
  }

  async insertAlias(tx: Database, row: typeof cardKeyAliases.$inferSelect): Promise<void> {
    await tx.insert(cardKeyAliases).values(row)
  }

  /** The cards directly under this one. */
  async childIds(cardId: string): Promise<string[]> {
    const rows = await this.db.select({ id: cards.id }).from(cards).where(eq(cards.parentId, cardId))
    return rows.map((row) => row.id)
  }

  /** The backlog's order (3.3): every card of the space in these states, by backlog rank. */
  async backlog(spaceId: string, stateIds: readonly string[], except?: string) {
    const rows = await this.db
      .select({ id: cards.id, rank: cards.backlogRank })
      .from(cards)
      .where(and(eq(cards.spaceId, spaceId), inArray(cards.stateId, [...stateIds])))
      .orderBy(asc(cards.backlogRank), asc(cards.number))

    return rows.filter((row) => row.id !== except)
  }

  async renumberBacklog(tx: Database, ids: readonly string[]): Promise<void> {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(cards)
        .set({ backlogRank: index + 1 })
        .where(eq(cards.id, id))
    }
  }

  /** The bottom of the backlog: past every card of the space, in or out of it. */
  async lastBacklogRank(spaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ top: max(cards.backlogRank) })
      .from(cards)
      .where(eq(cards.spaceId, spaceId))
    return row?.top ?? 0
  }
}
