import { z } from 'zod'

import type { CardService } from '../cards/card.service.js'
import type { CommentService } from '../cards/comment.service.js'
import { createLinkSchema } from '../cards/link.schemas.js'
import type { LinkService } from '../cards/link.service.js'
import { type CardView, createCardSchema, updateCardSchema } from '../cards/schemas.js'
import { type ReadDeps, spaceByKey } from './read-tools.js'
import { cardKeySchema, defineTool, spaceKeySchema, type Tool } from './tool.js'

type PersonDeps = Pick<ReadDeps, 'spaces' | 'spaceRows'> & {
  cards: CardService
  comments: CommentService
  links: LinkService
  /** The panel's address, for the link to what was written. */
  webUrl: string
}

/** A card as the answer of a write: what it is now, and where a person opens it. */
const written = (card: CardView, webUrl: string) => ({
  id: card.id,
  key: card.key,
  title: card.title,
  stateId: card.stateId,
  typeId: card.typeId,
  priority: card.priority,
  assignee: card.assignee,
  labels: card.labels,
  url: `${webUrl}/espacos/${card.key.split('-')[0]}?card=${card.key}`
})

const writingTools = (deps: PersonDeps): Tool[] => [
  defineTool({
    name: 'create_card',
    title: 'Create a card',
    description:
      'Create a card in a space, as the person, at once. Type, state, assignee and parent are ids from describe_space and list_members; without type or state the space’s first ones are used.',
    input: createCardSchema.extend({ space: spaceKeySchema }),
    audience: 'person',
    writes: true,
    run: async ({ space, ...card }, context) => {
      const found = await spaceByKey(deps, space, context)
      return written(await deps.cards.create(context.caller, found.id, card), deps.webUrl)
    }
  }),
  defineTool({
    name: 'update_card',
    title: 'Update a card',
    description:
      'Change fields of a card, as the person, at once — title, description, state (to move it), type, assignee, squad, priority, labels, due date, estimate, parent, custom fields. Only the fields sent change.',
    input: z.object({ card: cardKeySchema, changes: updateCardSchema }),
    audience: 'person',
    writes: true,
    overwrites: true,
    run: async ({ card, changes }, { caller }) => {
      const found = await deps.cards.readByKey(caller, card)
      return written(await deps.cards.update(caller, found.id, changes), deps.webUrl)
    }
  })
]

const conversationTools = (deps: PersonDeps): Tool[] => [
  defineTool({
    name: 'comment_on_card',
    title: 'Comment on a card',
    description: 'Write a comment on a card, as the person, at once. Mention someone as <@memberId>.',
    input: z.object({ card: cardKeySchema, body: z.string().trim().min(1).max(20_000) }),
    audience: 'person',
    writes: true,
    run: async ({ card, body }, { caller }) => {
      const found = await deps.cards.readByKey(caller, card)
      const { items } = await deps.comments.create(caller, found.id, body)
      return { card: found.key, comment: items.at(-1) }
    }
  }),
  defineTool({
    name: 'link_cards',
    title: 'Link two cards',
    description:
      'Link a card to another, as the person, at once: relates, blocks, duplicates, delivers or causes. "outward" means this card does it to the other.',
    input: z.object({ card: cardKeySchema, link: createLinkSchema }),
    audience: 'person',
    writes: true,
    run: async ({ card, link }, { caller }) => {
      const found = await deps.cards.readByKey(caller, card)
      return { card: found.key, ...(await deps.links.link(caller, found.id, link)) }
    }
  })
]

/**
 * What a person — through an assistant connected by OAuth, or their own token — writes with
 * (ADR-0022): the same services as the panel, with their roles, at once. The trail marks the
 * application the write came through.
 */
export const personTools = (deps: PersonDeps): Tool[] => [...writingTools(deps), ...conversationTools(deps)]
