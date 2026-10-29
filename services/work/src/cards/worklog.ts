import { toIso } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { cardWorklogs, members } from '../schema.js'
import type { CardGate } from './card-gate.js'

/** One entry of time logged in Jira, as the card shows it — read only (ADR-0036). */
export const worklogViewSchema = z.object({
  id: z.uuid(),
  author: z.object({ id: z.uuid(), name: z.string() }),
  startedAt: z.string(),
  seconds: z.number().int(),
  comment: z.string()
})
export const worklogListSchema = z.object({ items: z.array(worklogViewSchema) })
export type WorklogView = z.infer<typeof worklogViewSchema>

/**
 * The time logged on a card in Jira, oldest first. JiraIA does not track time; the migration keeps
 * what Jira had so that nothing is lost, and nobody writes here.
 */
export class WorklogService {
  constructor(private readonly deps: { db: Database; cardGate: CardGate }) {}

  async list(caller: Caller, cardId: string): Promise<{ items: WorklogView[] }> {
    const { card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const rows = await this.deps.db
      .select({ worklog: cardWorklogs, authorName: members.name })
      .from(cardWorklogs)
      .innerJoin(members, eq(members.id, cardWorklogs.authorId))
      .where(eq(cardWorklogs.cardId, card.id))
      .orderBy(asc(cardWorklogs.startedAt))
    return {
      items: rows.map(({ worklog, authorName }) => ({
        id: worklog.id,
        author: { id: worklog.authorId, name: authorName },
        startedAt: toIso(worklog.startedAt),
        seconds: worklog.seconds,
        comment: worklog.comment
      }))
    }
  }
}
