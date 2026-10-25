import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, type SQL } from 'drizzle-orm'

import { type StateGroup, stateGroupSchema } from '../cards/schemas.js'
import { cardComments, cards, contents, drawSpaces, spaces, workflowStates } from '../schema.js'

/** A card found by text: what a result line shows, and the description an excerpt is cut from. */
export type FoundCard = {
  id: string
  key: string
  title: string
  description: string
  spaceId: string
  state: { name: string; group: StateGroup }
}

export class SearchRepository {
  constructor(private readonly db: Database) {}

  /** Cards matching `where` (over `cards` joined to `spaces`), most recently changed first. */
  async cards(where: SQL | undefined, limit: number): Promise<FoundCard[]> {
    const rows = await this.db
      .select({ card: cards, spaceKey: spaces.key, stateName: workflowStates.name, stateGroup: workflowStates.group })
      .from(cards)
      .innerJoin(spaces, eq(spaces.id, cards.spaceId))
      .innerJoin(workflowStates, eq(workflowStates.id, cards.stateId))
      .where(where)
      .orderBy(desc(cards.updatedAt), asc(cards.number))
      .limit(limit)

    return rows.map(({ card, spaceKey, stateName, stateGroup }) => ({
      id: card.id,
      key: `${spaceKey}-${card.number}`,
      title: card.title,
      description: card.description,
      spaceId: card.spaceId,
      state: { name: stateName, group: stateGroupSchema.parse(stateGroup) }
    }))
  }

  /** Comments holding `pattern`, newest first, on the cards `visible` lets through. */
  async comments(visible: SQL | undefined, pattern: string, limit: number) {
    return await this.db
      .select({ cardId: cardComments.cardId, body: cardComments.body })
      .from(cardComments)
      .innerJoin(cards, eq(cards.id, cardComments.cardId))
      .innerJoin(spaces, eq(spaces.id, cards.spaceId))
      .where(and(visible, ilike(cardComments.body, pattern)))
      .orderBy(desc(cardComments.createdAt))
      .limit(limit)
  }

  /** Pages and whiteboards holding `pattern`: of every Draw space, and of the wiki collections given. */
  async contents(organizationId: string, pattern: string, limit: number, wikiIds: readonly string[]) {
    const draw = eq(drawSpaces.area, 'draw')
    const readable = wikiIds.length ? or(draw, inArray(contents.spaceId, [...wikiIds])) : draw
    return await this.db
      .select({
        id: contents.id,
        kind: contents.kind,
        title: contents.title,
        spaceId: contents.spaceId,
        spaceName: drawSpaces.name,
        area: drawSpaces.area,
        text: contents.contentText
      })
      .from(contents)
      .innerJoin(drawSpaces, eq(drawSpaces.id, contents.spaceId))
      .where(
        and(
          eq(contents.organizationId, organizationId),
          isNull(contents.deletedAt),
          isNull(drawSpaces.deletedAt),
          readable,
          ne(contents.kind, 'folder'),
          or(ilike(contents.title, pattern), ilike(contents.contentText, pattern))
        )
      )
      .orderBy(desc(contents.updatedAt))
      .limit(limit)
  }
}
