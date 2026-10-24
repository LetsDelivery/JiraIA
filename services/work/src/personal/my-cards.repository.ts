import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { prioritySchema, stateGroupSchema } from '../cards/schemas.js'
import {
  cardLinks,
  cards,
  groupMembers,
  members,
  spaceGroupRoles,
  spaceMembers,
  spaces,
  sprints,
  workflowStates
} from '../schema.js'
import { cardStars } from '../schema-intake.js'
import type { MyCardTab } from './my-cards.schemas.js'

const assignee = alias(members, 'assignee')
const LIMIT = 50
const PRIORITY_ORDER = sql`case ${cards.priority} when 'highest' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`

/** Who is asking. */
export type Asker = { organizationId: string; meId: string }

/** A tab as SQL: which cards, the instant it shows for each, and in what order. */
type Tab = { where: SQL | undefined; at: SQL; order: SQL[] }

const isOpen = sql`${workflowStates.group} not in ('done', 'cancelled')`

const starredAt = ({ meId }: Asker): SQL =>
  sql`(select ${cardStars.createdAt} from ${cardStars} where ${cardStars.cardId} = ${cards.id} and ${cardStars.memberId} = ${meId})`

/** A space where the caller holds a role, directly or through a group (ADR-0012). */
const holdsRole = ({ meId }: Asker): SQL => sql`(
  ${cards.spaceId} in (select ${spaceMembers.spaceId} from ${spaceMembers} where ${spaceMembers.memberId} = ${meId})
  or ${cards.spaceId} in (select ${spaceGroupRoles.spaceId} from ${spaceGroupRoles}
    inner join ${groupMembers} on ${groupMembers.groupId} = ${spaceGroupRoles.groupId}
    where ${groupMembers.memberId} = ${meId}))`

/** In the running sprint of its own space — never the backlog, never a future or closed sprint. */
const inActiveSprint = sql`${cards.sprintId} in (select ${sprints.id} from ${sprints}
  where ${sprints.spaceId} = ${cards.spaceId} and ${sprints.state} = 'active')`

/** The cards neither done nor cancelled, of any space. */
const stillOpen = sql`select ${cards.id} from ${cards}
  inner join ${workflowStates} on ${workflowStates.id} = ${cards.stateId}
  where ${workflowStates.group} not in ('done', 'cancelled')`

/**
 * Another card still open blocks it (escopo-mvp 2.7). `cards` in `stillOpen` is the inner query's own;
 * `to_card_id` is compared with the outer card.
 */
const blocked = sql`exists (select 1 from ${cardLinks}
  where ${cardLinks.type} = 'blocks' and ${cardLinks.toCardId} = ${cards.id}
    and ${cardLinks.fromCardId} in (${stillOpen}))`

const recommended = (asker: Asker): SQL | undefined =>
  and(
    eq(workflowStates.group, 'not_started'),
    inActiveSprint,
    or(isNull(cards.assigneeId), eq(cards.assigneeId, asker.meId)),
    holdsRole(asker),
    sql`not ${blocked}`
  )

const TABS: Record<MyCardTab, (asker: Asker) => Tab> = {
  starred: (asker) => {
    const at = starredAt(asker)
    return { where: isNotNull(at), at, order: [desc(at)] }
  },
  assigned: ({ meId }) => ({
    where: and(eq(cards.assigneeId, meId), isOpen),
    at: sql`${cards.updatedAt}`,
    order: [asc(PRIORITY_ORDER), sql`${cards.dueDate} asc nulls last`, desc(cards.updatedAt)]
  }),
  recommended: (asker) => ({
    where: recommended(asker),
    at: sql`${cards.updatedAt}`,
    order: [asc(PRIORITY_ORDER), asc(cards.backlogRank)]
  })
}

/** The caller's own lists of cards (Para você), and the stars one of them is made of. */
export class MyCardsRepository {
  constructor(private readonly db: Database) {}

  async list(tab: MyCardTab, asker: Asker) {
    const { where, at, order } = TABS[tab](asker)
    const rows = await this.db
      .select({
        card: cards,
        spaceKey: spaces.key,
        stateName: workflowStates.name,
        stateGroup: workflowStates.group,
        assigneeName: assignee.name,
        at: at.mapWith(cards.updatedAt)
      })
      .from(cards)
      .innerJoin(spaces, eq(spaces.id, cards.spaceId))
      .innerJoin(workflowStates, eq(workflowStates.id, cards.stateId))
      .leftJoin(assignee, eq(assignee.id, cards.assigneeId))
      .where(and(eq(cards.organizationId, asker.organizationId), isNull(spaces.archivedAt), where))
      .orderBy(...order, asc(spaces.key), asc(cards.number))
      .limit(LIMIT)

    return rows.map(({ card, spaceKey, stateName, stateGroup, assigneeName, at: seen }) => ({
      id: card.id,
      key: `${spaceKey}-${card.number}`,
      title: card.title,
      spaceId: card.spaceId,
      state: { name: stateName, group: stateGroupSchema.parse(stateGroup) },
      priority: prioritySchema.parse(card.priority),
      dueDate: card.dueDate,
      assignee: card.assigneeId && assigneeName ? { id: card.assigneeId, name: assigneeName } : null,
      at: seen
    }))
  }

  async isStarred(memberId: string, cardId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ cardId: cardStars.cardId })
      .from(cardStars)
      .where(and(eq(cardStars.memberId, memberId), eq(cardStars.cardId, cardId)))
    return row !== undefined
  }

  async star(memberId: string, cardId: string, at: Date): Promise<void> {
    await this.db.insert(cardStars).values({ memberId, cardId, createdAt: at }).onConflictDoNothing()
  }

  async unstar(memberId: string, cardId: string): Promise<void> {
    await this.db.delete(cardStars).where(and(eq(cardStars.memberId, memberId), eq(cardStars.cardId, cardId)))
  }
}
