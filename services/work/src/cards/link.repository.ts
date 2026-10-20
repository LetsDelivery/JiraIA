import type { Database } from '@jiraia/db'
import { and, asc, eq, or, type SQL } from 'drizzle-orm'

import { cardLinks, cards, spaces, workflowStates } from '../schema.js'
import type { LinkRow, LinkType } from './link.schemas.js'
import { type StateGroup, stateGroupSchema } from './schemas.js'

/** A card as a relation shows it. */
export type RefRow = {
  id: string
  key: string
  title: string
  spaceId: string
  state: { name: string; group: StateGroup }
  reporterId: string
  assigneeId: string | null
}

export class LinkRepository {
  constructor(private readonly db: Database) {}

  /** Cards with their key and state, in number order. */
  async refs(where: SQL | undefined): Promise<RefRow[]> {
    const rows = await this.db
      .select({ card: cards, spaceKey: spaces.key, stateName: workflowStates.name, stateGroup: workflowStates.group })
      .from(cards)
      .innerJoin(spaces, eq(spaces.id, cards.spaceId))
      .innerJoin(workflowStates, eq(workflowStates.id, cards.stateId))
      .where(where)
      .orderBy(asc(spaces.key), asc(cards.number))

    return rows.map(({ card, spaceKey, stateName, stateGroup }) => ({
      id: card.id,
      key: `${spaceKey}-${card.number}`,
      title: card.title,
      spaceId: card.spaceId,
      state: { name: stateName, group: stateGroupSchema.parse(stateGroup) },
      reporterId: card.reporterId,
      assigneeId: card.assigneeId
    }))
  }

  async children(cardId: string): Promise<RefRow[]> {
    return await this.refs(eq(cards.parentId, cardId))
  }

  async ref(cardId: string): Promise<RefRow | undefined> {
    const [row] = await this.refs(eq(cards.id, cardId))
    return row
  }

  /** Every link the card is on, at either end. */
  async linksOf(cardId: string): Promise<LinkRow[]> {
    return await this.db
      .select()
      .from(cardLinks)
      .where(or(eq(cardLinks.fromCardId, cardId), eq(cardLinks.toCardId, cardId)))
      .orderBy(asc(cardLinks.createdAt))
  }

  async find(cardId: string, linkId: string): Promise<LinkRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cardLinks)
      .where(and(eq(cardLinks.id, linkId), or(eq(cardLinks.fromCardId, cardId), eq(cardLinks.toCardId, cardId))))
    return row
  }

  /** The same link, either way round for `relates`, which reads the same from both ends. */
  async exists(type: LinkType, from: string, to: string): Promise<boolean> {
    const forward = and(eq(cardLinks.fromCardId, from), eq(cardLinks.toCardId, to))
    const backward = and(eq(cardLinks.fromCardId, to), eq(cardLinks.toCardId, from))
    const [row] = await this.db
      .select({ id: cardLinks.id })
      .from(cardLinks)
      .where(and(eq(cardLinks.type, type), type === 'relates' ? or(forward, backward) : forward))
    return row !== undefined
  }

  async insert(tx: Database, row: LinkRow): Promise<void> {
    await tx.insert(cardLinks).values(row)
  }

  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(cardLinks).where(eq(cardLinks.id, id))
  }
}
