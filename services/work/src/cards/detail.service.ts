import type { Caller } from '@jiraia/http'
import { z } from 'zod'

import { auditEventViewSchema } from '../audit/audit.js'
import type { GitHubConnectService } from '../github/github-connect.service.js'
import { devLinkListSchema } from '../github/schemas.js'
import type { MyCardsService } from '../personal/my-cards.service.js'
import type { ProposalService } from '../proposals/proposal.service.js'
import { proposalListSchema } from '../proposals/schemas.js'
import { attachmentListSchema } from './attachment.schemas.js'
import type { AttachmentService } from './attachment.service.js'
import type { CardService } from './card.service.js'
import type { CommentService } from './comment.service.js'
import { relationsViewSchema } from './link.schemas.js'
import type { LinkService } from './link.service.js'
import { cardViewSchema, commentListSchema, watcherListSchema } from './schemas.js'
import type { WatcherService } from './watcher.service.js'
import { type WorklogService, worklogListSchema } from './worklog.js'

/** Everything the opened card shows, in one answer: one request instead of ten. */
export const cardDetailSchema = z.object({
  card: cardViewSchema,
  proposals: proposalListSchema.shape.items,
  comments: commentListSchema.shape.items,
  history: z.array(auditEventViewSchema),
  relations: relationsViewSchema,
  attachments: attachmentListSchema.shape.items,
  watchers: watcherListSchema.shape.items,
  worklogs: worklogListSchema.shape.items,
  development: devLinkListSchema.shape.items,
  starred: z.boolean()
})
export type CardDetail = z.infer<typeof cardDetailSchema>

type DetailDeps = {
  cards: CardService
  comments: CommentService
  links: LinkService
  attachments: AttachmentService
  watchers: WatcherService
  worklogs: WorklogService
  myCards: MyCardsService
  proposals: ProposalService
  github: GitHubConnectService
}

/**
 * An opened card's whole page. Each part is read by the service that owns it, with that service's
 * own permission check, so this answer never shows more than the separate routes would.
 */
export class CardDetailService {
  constructor(private readonly deps: DetailDeps) {}

  async read(caller: Caller, cardId: string): Promise<CardDetail> {
    const { cards, comments, links, attachments, watchers, worklogs, myCards, proposals, github } = this.deps
    // The card first: it alone answers 404 or 403, before nine reads that would refuse the same way.
    const card = await cards.read(caller, cardId)
    const [pending, talk, history, relations, files, followers, logged, dev, star] = await Promise.all([
      proposals.forCard(caller, card.id),
      comments.list(caller, card.id),
      cards.history(caller, card.id),
      links.relations(caller, card.id),
      attachments.list(caller, card.id),
      watchers.list(caller, card.id),
      worklogs.list(caller, card.id),
      github.development(caller, card.id),
      myCards.starred(caller, card.id)
    ])
    return {
      ...{ card, proposals: pending.items, comments: talk.items, history: history.items, relations },
      ...{ attachments: files.items, watchers: followers.items, worklogs: logged.items, development: dev.items },
      starred: star.starred
    }
  }
}
