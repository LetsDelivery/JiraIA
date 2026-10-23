import { NotFoundException } from '@jiraia/core'
import { z } from 'zod'

import type { CardService } from '../cards/card.service.js'
import type { CommentService } from '../cards/comment.service.js'
import type { FieldService } from '../cards/field.service.js'
import type { LinkService } from '../cards/link.service.js'
import type { CardView } from '../cards/schemas.js'
import type { WorkflowService } from '../cards/workflow.service.js'
import type { ContentService } from '../draw/content.service.js'
import type { MemberService } from '../members/member.service.js'
import type { ProposalService } from '../proposals/proposal.service.js'
import { cardFilterSchema, cardOrderSchema } from '../search/filter.schemas.js'
import type { SearchService } from '../search/search.service.js'
import type { SpaceRepository } from '../spaces/space.repository.js'
import type { SpaceService } from '../spaces/space.service.js'
import type { SprintService } from '../sprints/sprint.service.js'
import { cardKeySchema, defineTool, spaceKeySchema, type Tool, type ToolContext } from './tool.js'

export type ReadDeps = {
  spaces: SpaceService
  spaceRows: SpaceRepository
  workflows: WorkflowService
  fields: FieldService
  search: SearchService
  cards: CardService
  comments: CommentService
  links: LinkService
  contents: ContentService
  members: MemberService
  proposals: ProposalService
  sprints: SprintService
}

/** A space the caller reads, by its key: 404 for a key that is not one, as for one they cannot read. */
export const spaceByKey = async (
  deps: Pick<ReadDeps, 'spaces' | 'spaceRows'>,
  key: string,
  { caller, actor }: ToolContext
) => {
  const row = await deps.spaceRows.findByKey(actor.organizationId, key.toUpperCase())
  if (!row) {
    throw new NotFoundException('Space', key)
  }
  return await deps.spaces.read(caller, row.id)
}

/** A card as a line of a list: enough to recognise it, see where it stands and name it again. */
const cardLine = (card: CardView) => ({
  id: card.id,
  key: card.key,
  title: card.title,
  stateId: card.stateId,
  typeId: card.typeId,
  priority: card.priority,
  assignee: card.assignee,
  labels: card.labels,
  dueDate: card.dueDate,
  points: card.points,
  sprintId: card.sprintId,
  updatedAt: card.updatedAt
})

const spaceTools = (deps: ReadDeps): Tool[] => [
  defineTool({
    name: 'list_spaces',
    title: 'List spaces',
    description: 'Every JiraIA space the caller can read, with its key. A card key starts with its space key.',
    input: z.object({}),
    run: async (_, { caller }) => ({
      items: (await deps.spaces.list(caller, false)).items.map(({ id, key, name, type, description }) => ({
        id,
        key,
        name,
        type,
        description
      }))
    })
  }),
  defineTool({
    name: 'describe_space',
    title: 'Describe a space',
    description:
      "A space's states (in board order, each with its group), card types and custom fields, with their ids — what query_cards and propose_changes take.",
    input: z.object({ space: spaceKeySchema }),
    run: async ({ space }, context) => {
      const found = await spaceByKey(deps, space, context)
      const [workflow, fields] = await Promise.all([
        deps.workflows.get(context.caller, found.id),
        deps.fields.list(context.caller, found.id)
      ])
      return { space: { id: found.id, key: found.key, name: found.name }, ...workflow, fields: fields.items }
    }
  }),
  defineTool({
    name: 'list_members',
    title: 'List members',
    description:
      'People and agents of the organization, with the ids that assign a card. Filter by part of a name or e-mail.',
    input: z.object({ query: z.string().trim().max(100).optional() }),
    run: async ({ query }, { caller }) => {
      const needle = query?.toLowerCase() ?? ''
      const { items } = await deps.members.list(caller)
      return {
        items: items
          .filter((member) => member.status === 'active' && !member.isSystem)
          .filter((member) => `${member.name} ${member.email ?? ''}`.toLowerCase().includes(needle))
          .map(({ id, name, email, kind }) => ({ id, name, email, kind }))
      }
    }
  })
]

const cardTools = (deps: ReadDeps): Tool[] => [
  defineTool({
    name: 'search',
    title: 'Search',
    description:
      'Free text over cards (key, title, description, comments) and LET’S Draw AI pages and whiteboards. A card key finds that card.',
    input: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) }),
    run: async ({ query, limit }, { caller }) => await deps.search.text(caller, query, limit)
  }),
  defineTool({
    name: 'query_cards',
    title: 'Query cards',
    description:
      'Cards matching a structured filter — the JQL of JiraIA. Every condition named must hold; within one, any value matches. Ids come from describe_space and list_members; "me" is the caller.',
    input: z.object({
      space: spaceKeySchema.optional(),
      filter: cardFilterSchema.default({}),
      order: cardOrderSchema.default({ by: 'updated', descending: true }),
      limit: z.number().int().min(1).max(200).default(50)
    }),
    run: async ({ space, filter, order, limit }, context) => {
      const spaceIds = space ? [(await spaceByKey(deps, space, context)).id] : filter.spaceIds
      const { items } = await deps.search.cards(context.caller, { filter: { ...filter, spaceIds }, order, limit })
      return { items: items.map(cardLine) }
    }
  }),
  defineTool({
    name: 'get_card',
    title: 'Get a card',
    description: 'One card by its key: every field, its comments, its parent, subtasks and links.',
    input: z.object({ card: cardKeySchema }),
    run: async ({ card }, { caller }) => {
      const found = await deps.cards.readByKey(caller, card)
      const [comments, relations] = await Promise.all([
        deps.comments.list(caller, found.id),
        deps.links.relations(caller, found.id)
      ])
      return { card: found, comments: comments.items, relations }
    }
  }),
  defineTool({
    name: 'get_page',
    title: 'Get a page',
    description: 'A LET’S Draw AI page or whiteboard as text, by the id search returned.',
    input: z.object({ pageId: z.uuid() }),
    run: async ({ pageId }, { caller }) => await deps.contents.readText(caller, pageId)
  })
]

const proposalReadTools = (deps: ReadDeps): Tool[] => [
  defineTool({
    name: 'list_proposals',
    title: 'List proposals',
    description:
      'For an agent, the proposals it made; for a person, the ones they may decide (pending) or were decided.',
    input: z.object({ status: z.enum(['pending', 'decided']).default('pending') }),
    run: async ({ status }, { caller }) => await deps.proposals.list(caller, { status })
  }),
  defineTool({
    name: 'get_proposal',
    title: 'Get a proposal',
    description:
      "Where a proposal stands: pending, applied (by whom, with any adjustment), rejected (with the note), withdrawn, expired or reverted — and each item's fate.",
    input: z.object({ proposalId: z.uuid() }),
    run: async ({ proposalId }, { caller }) => await deps.proposals.read(caller, proposalId)
  })
]

/** A space's sprints and what one holds (ADR-0029). Moving a card is `update_card` or a proposal, with `sprintId`. */
const sprintTools = (deps: ReadDeps): Tool[] => [
  defineTool({
    name: 'list_sprints',
    title: 'List sprints',
    description:
      "A space's sprints, oldest first: planned, the one active, closed — with dates, goal, and what each committed, completed and carried. A card goes to one with its sprintId.",
    input: z.object({ space: spaceKeySchema }),
    run: async ({ space }, context) =>
      await deps.sprints.list(context.caller, (await spaceByKey(deps, space, context)).id)
  }),
  defineTool({
    name: 'get_sprint',
    title: 'Get a sprint',
    description:
      'One sprint with its cards and their points — the active one unless a sprintId is given. Cards say where they stand by stateId (describe_space names it).',
    input: z.object({ space: spaceKeySchema, sprintId: z.uuid().optional() }),
    run: async ({ space, sprintId }, context) => {
      const found = await spaceByKey(deps, space, context)
      const { items } = await deps.sprints.list(context.caller, found.id)
      const sprint = sprintId
        ? items.find((each) => each.id === sprintId)
        : items.find((each) => each.state === 'active')
      if (!sprint) {
        throw new NotFoundException('Sprint', sprintId ?? `active in ${found.key}`)
      }
      const cards = await deps.cards.list(context.caller, found.id, sprint.id)
      return { sprint, cards: cards.items.map(cardLine) }
    }
  })
]

/** What any member may call: reading JiraIA as their own access allows. */
export const readTools = (deps: ReadDeps): Tool[] => [
  ...spaceTools(deps),
  ...cardTools(deps),
  ...sprintTools(deps),
  ...proposalReadTools(deps)
]
