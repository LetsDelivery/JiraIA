import type { Database } from '@jiraia/db'
import { and, eq, getTableColumns, type SQL, type SQLWrapper, sql } from 'drizzle-orm'

import { labelColorSql } from '../cards/card.repository.js'
import {
  auditEvents,
  cardComments,
  cardKeyAliases,
  cards,
  cardTypes,
  customFields,
  labels,
  members,
  savedViews,
  spaces,
  sprints,
  workflowStates
} from '../schema.js'
import { importRefs } from '../schema-import.js'
import { automations, forms } from '../schema-intake.js'

export type RefRow = typeof importRefs.$inferSelect
export type CardInsert = typeof cards.$inferInsert
export type CommentInsert = typeof cardComments.$inferInsert
export type Ref = { targetId: string; contentHash: string }

/** `set` for an upsert: every column the rows carry, but `kept`, from the row that was refused. */
const fromExcluded = (table: typeof cards, row: object, kept: string[]): Record<string, SQL> => {
  const columns = getTableColumns(table) as Record<string, { name: string }>
  const names = Object.keys(row).filter((key) => !kept.includes(key) && columns[key])
  return Object.fromEntries(names.map((key) => [key, sql.raw(`excluded.${(columns[key] as { name: string }).name}`)]))
}

/**
 * The importer's writes (Etapa 8c, ADR-0036). Rows go in with Jira's own authors and dates, past the
 * services: those take the clock and the signed-in caller, and leave events undispatched, which would
 * notify people about the past.
 */
export class ImportRepository {
  constructor(private readonly db: Database) {}

  async refs(organizationId: string, source: string, entity: string): Promise<Map<string, Ref>> {
    const rows = await this.db
      .select()
      .from(importRefs)
      .where(
        and(eq(importRefs.organizationId, organizationId), eq(importRefs.source, source), eq(importRefs.entity, entity))
      )
    return new Map(rows.map((row) => [row.sourceId, { targetId: row.targetId, contentHash: row.contentHash }]))
  }

  async putRefs(tx: Database, rows: RefRow[]): Promise<void> {
    if (rows.length === 0) {
      return
    }
    await tx
      .insert(importRefs)
      .values(rows)
      .onConflictDoUpdate({
        target: [importRefs.organizationId, importRefs.source, importRefs.entity, importRefs.sourceId],
        set: {
          targetId: sql`excluded.target_id`,
          contentHash: sql`excluded.content_hash`,
          runId: sql`excluded.run_id`,
          importedAt: sql`excluded.imported_at`
        }
      })
  }

  /** Who runs the import, by e-mail, and their organization. */
  async actor(email: string): Promise<{ organizationId: string; memberId: string } | undefined> {
    const [row] = await this.db
      .select({ organizationId: members.organizationId, memberId: members.id })
      .from(members)
      .where(eq(members.email, email.toLowerCase()))
    return row
  }

  async membersByEmail(organizationId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: members.id, email: members.email })
      .from(members)
      .where(eq(members.organizationId, organizationId))
    return new Map(rows.filter((row) => row.email).map((row) => [String(row.email), row.id]))
  }

  async spaceByKey(organizationId: string, key: string) {
    const [row] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.organizationId, organizationId), eq(spaces.key, key)))
    return row
  }

  async states(spaceId: string) {
    return await this.db.select().from(workflowStates).where(eq(workflowStates.spaceId, spaceId))
  }

  async types(spaceId: string) {
    return await this.db.select().from(cardTypes).where(eq(cardTypes.spaceId, spaceId))
  }

  async fields(spaceId: string) {
    return await this.db.select().from(customFields).where(eq(customFields.spaceId, spaceId))
  }

  async sprints(spaceId: string) {
    return await this.db.select().from(sprints).where(eq(sprints.spaceId, spaceId))
  }

  async cardNumbers(spaceId: string): Promise<Map<number, string>> {
    const rows = await this.db
      .select({ id: cards.id, number: cards.number })
      .from(cards)
      .where(eq(cards.spaceId, spaceId))
    return new Map(rows.map((row) => [row.number, row.id]))
  }

  /**
   * New and changed cards in one statement: a row already there takes what Jira says now, and keeps
   * what only JiraIA holds (its group, its t-shirt estimate) — one call for a batch, not four a card.
   */
  async upsertCards(tx: Database, rows: CardInsert[]): Promise<void> {
    await tx
      .insert(cards)
      .values(rows)
      .onConflictDoUpdate({
        target: cards.id,
        set: fromExcluded(cards, rows[0] ?? {}, ['id', 'organizationId', 'spaceId', 'number'])
      })
  }

  /** New and edited comments in one statement; an edit changes the body, its mentions and its edit date. */
  async upsertComments(tx: Database, rows: CommentInsert[]): Promise<void> {
    await tx
      .insert(cardComments)
      .values(rows)
      .onConflictDoUpdate({
        target: cardComments.id,
        set: { body: sql`excluded.body`, mentions: sql`excluded.mentions`, editedAt: sql`excluded.edited_at` }
      })
  }

  /** Parents in one statement: a card's parent may come later in Jira's order than the card itself. */
  async setParents(tx: Database, pairs: { id: string; parentId: string }[]): Promise<void> {
    if (pairs.length === 0) {
      return
    }
    const rows = sql.join(
      pairs.map((pair) => sql`(${pair.id}::uuid, ${pair.parentId}::uuid)`),
      sql`, `
    )
    await tx.execute(sql`
      update ${cards} set parent_id = v.parent_id
      from (values ${rows}) as v(id, parent_id)
      where ${cards.id} = v.id`)
  }

  async insertAliases(tx: Database, rows: (typeof cardKeyAliases.$inferInsert)[]): Promise<void> {
    if (rows.length > 0) {
      await tx.insert(cardKeyAliases).values(rows).onConflictDoNothing()
    }
  }

  /** The space's label catalogue learns every label its cards carry (ADR-0032), in one statement. */
  async registerSpaceLabels(tx: Database, spaceId: string): Promise<void> {
    await tx.execute(sql`
      insert into ${labels} (id, space_id, name, color, created_at)
      select gen_random_uuid(), ${spaceId}::uuid, l.name, ${labelColorSql(sql`l.name`)}, now()
      from (select distinct jsonb_array_elements_text(${cards.labels}) as name from ${cards} where ${eq(cards.spaceId, spaceId)}) as l
      on conflict (space_id, name) do nothing`)
  }

  /** The next card is numbered after the highest imported one, so no Jira key is ever reused. */
  async settleSpace(tx: Database, spaceId: string): Promise<void> {
    await tx.execute(sql`
      update ${spaces} set
        next_card_number = greatest(next_card_number, coalesce((select max(number) + 1 from ${cards} where ${eq(cards.spaceId, spaceId)}), 1)),
        last_card_activity_at = (select max(updated_at) from ${cards} where ${eq(cards.spaceId, spaceId)})
      where ${eq(spaces.id, spaceId)}`)
  }

  /**
   * Whether anything still names this state or type: a card, a form, a custom field, an automation or a
   * saved view. Only what nothing names may be removed to make a space's workflow Jira's.
   */
  async isNamed(id: string, kind: 'state' | 'type'): Promise<boolean> {
    const like = (column: SQLWrapper) => sql`${column}::text like ${`%${id}%`}`
    const checks = [
      this.db
        .select({ id: cards.id })
        .from(cards)
        .where(kind === 'state' ? eq(cards.stateId, id) : eq(cards.typeId, id))
        .limit(1),
      this.db
        .select({ id: forms.id })
        .from(forms)
        .where(kind === 'state' ? eq(forms.stateId, id) : eq(forms.typeId, id))
        .limit(1),
      this.db.select({ id: customFields.id }).from(customFields).where(like(customFields.typeIds)).limit(1),
      this.db
        .select({ id: automations.id })
        .from(automations)
        .where(like(sql`(${automations.conditions} || ${automations.actions})`))
        .limit(1),
      this.db.select({ id: savedViews.id }).from(savedViews).where(like(savedViews.filter)).limit(1)
    ]
    return (await Promise.all(checks)).some((rows) => rows.length > 0)
  }

  async audit(tx: Database, row: typeof auditEvents.$inferInsert): Promise<void> {
    await tx.insert(auditEvents).values(row)
  }
}
