import type { Database } from '@jiraia/db'
import { and, asc, eq, getTableColumns, gt, inArray, isNull, max, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { cardKeyAliases, cards, groups, labels, members, spaces } from '../schema.js'
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
    | 'points'
    | 'sprintId'
    | 'parentId'
    | 'customFields'
    | 'rank'
    | 'backlogRank'
    | 'spaceId'
    | 'number'
  >
>

/** How many cards one read brings; without descriptions, such a read stays far under the Data API's 1 MiB. */
const LIST_PAGE = 500

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

  /**
   * A space's cards for a board, a list or a backlog, in board order — those of one sprint, or with
   * none, when `sprintId` says so. Read in pages and without the description, which only a card's own
   * read carries: a space of thousands of cards would pass the Data API's 1 MiB answer (ADR-0027).
   */
  async list(spaceId: string, sprintId?: string | null): Promise<CardWithPeople[]> {
    const inSprint =
      sprintId === undefined ? undefined : sprintId === null ? isNull(cards.sprintId) : eq(cards.sprintId, sprintId)
    const rows: CardWithPeople[] = []
    for (let after = ''; ; ) {
      const page = await this._listPage(
        and(eq(cards.spaceId, spaceId), inSprint, after ? gt(cards.id, after) : undefined)
      )
      rows.push(...page)
      if (page.length < LIST_PAGE) {
        return rows.sort((a, b) => a.rank - b.rank)
      }
      after = (page.at(-1) as CardWithPeople).id
    }
  }

  private async _listPage(where: SQL | undefined): Promise<CardWithPeople[]> {
    const { description: _description, ...listed } = getTableColumns(cards)
    const rows = await this.db
      .select({
        card: listed,
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
      .orderBy(asc(cards.id))
      .limit(LIST_PAGE)
    return rows.map(
      (row): CardWithPeople => ({
        ...row.card,
        description: '',
        spaceKey: row.spaceKey,
        assigneeName: row.assigneeName,
        reporterName: row.reporterName,
        groupName: row.groupName
      })
    )
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
    await registerLabels(tx, row.id)
  }

  async update(tx: Database, id: string, fields: CardFields, at: Date): Promise<void> {
    await tx
      .update(cards)
      .set({ ...fields, updatedAt: at })
      .where(eq(cards.id, id))
    if (fields.labels !== undefined || fields.spaceId !== undefined) {
      await registerLabels(tx, id)
    }
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

/**
 * The space's catalogue learns each label the card carries and it lacks (ADR-0032), in the colour
 * `colorOf` gives the name — repeated here in SQL so it holds whichever way the card was written: an
 * edit, a bulk change, a form, an automation, an agent.
 */
export const registerLabels = async (tx: Database, cardId: string): Promise<void> => {
  await tx.execute(sql`
    insert into ${labels} (id, space_id, name, color, created_at)
    select gen_random_uuid(), ${cards.spaceId}, l.name, ${labelColorSql(sql`l.name`)}, now()
    from ${cards} cross join lateral jsonb_array_elements_text(${cards.labels}) as l(name)
    where ${eq(cards.id, cardId)}
    on conflict (space_id, name) do nothing`)
}

/** `colorOf` in SQL: the first 7 hex digits of the name's md5, modulo the eight colours. */
export const labelColorSql = (name: SQL): SQL =>
  sql`(array['red','orange','yellow','green','teal','blue','violet','pink'])[1 + (('x' || lpad(substr(md5(${name}), 1, 7), 8, '0'))::bit(32)::int % 8)]`
