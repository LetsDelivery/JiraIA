import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { cardComments, cards, cardTypes, workflowStates } from '../schema.js'
import { typeColorSchema, typeIconSchema } from './card-type.schemas.js'

export type StateRow = typeof workflowStates.$inferSelect
export type CardTypeRow = typeof cardTypes.$inferSelect
export type CardRow = typeof cards.$inferSelect
export type CommentRow = typeof cardComments.$inferSelect

/** What reports read across spaces, whatever a state is called (escopo-mvp 2.2). */
export const stateGroupValues = ['not_started', 'in_progress', 'done', 'cancelled'] as const
export const stateGroupSchema = z.enum(stateGroupValues)
export type StateGroup = z.infer<typeof stateGroupSchema>

/** Jira's five levels, highest first (2.4). */
export const priorityValues = ['highest', 'high', 'medium', 'low', 'lowest'] as const
export const prioritySchema = z.enum(priorityValues)
export type Priority = z.infer<typeof prioritySchema>

export const stateViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  group: stateGroupSchema,
  position: z.number(),
  /** The board column it shows in; in a space with columns, `null` keeps it off the board (ADR-0037). */
  columnId: z.uuid().nullable()
})
/** A board column: the states it shows are those whose `columnId` is its id, in workflow order. */
export const columnViewSchema = z.object({ id: z.uuid(), name: z.string(), position: z.number() })
export const cardTypeViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  icon: typeIconSchema,
  color: typeColorSchema,
  position: z.number(),
  /** A sub-task type: its cards show under their parent, not on the board (ADR-0037). */
  isSubtask: z.boolean()
})
/** A space's states, card types and board columns; no columns means one column per state. */
export const workflowViewSchema = z.object({
  states: z.array(stateViewSchema),
  types: z.array(cardTypeViewSchema),
  columns: z.array(columnViewSchema)
})
export type WorkflowView = z.infer<typeof workflowViewSchema>

const personSchema = z.object({ id: z.uuid(), name: z.string() })

export const cardViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  number: z.number().int(),
  spaceId: z.uuid(),
  typeId: z.uuid(),
  stateId: z.uuid(),
  title: z.string(),
  description: z.string(),
  assignee: personSchema.nullable(),
  reporter: personSchema,
  /** The group that owns the card — its squad, on screen (ADR-0012 groups). */
  group: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  priority: prioritySchema,
  labels: z.array(z.string()),
  dueDate: z.iso.date().nullable(),
  estimate: z.string().nullable(),
  points: z.number().nullable(),
  sprintId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  rank: z.number(),
  backlogRank: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type CardView = z.infer<typeof cardViewSchema>
/**
 * A space's cards, or only those of a sprint: the active one, one by id, or none — the backlog (ADR-0029).
 * `doneSince` (`-60d`) leaves out the cards that entered a done state before then, as the Lista does
 * (ADR-0040).
 */
export const cardListQuerySchema = z.object({
  sprint: z.union([z.enum(['active', 'none']), z.uuid()]).optional(),
  doneSince: z
    .string()
    .regex(/^-\d{1,4}d$/)
    .optional()
})
export type CardListQuery = z.infer<typeof cardListQuerySchema>
/** A space's cards, each without its description (empty): only reading the card itself carries it. */
export const cardListSchema = z.object({ items: z.array(cardViewSchema) })

/** Story points: Jira's 1, 2, 3, 5, 8, 13 or any other number a team uses, halves included. */
const pointsSchema = z.number().min(0).max(1000)

const labelsSchema = z.array(z.string().trim().min(1).max(60)).max(20)
const titleSchema = z.string().trim().min(1).max(255)

export const createCardSchema = z.object({
  title: titleSchema,
  typeId: z.uuid().optional(),
  stateId: z.uuid().optional(),
  description: z.string().max(50_000).default(''),
  assigneeId: z.uuid().nullable().optional(),
  priority: prioritySchema.default('medium'),
  labels: labelsSchema.default([]),
  /** A subtask is created under its parent, in the same space (2.6). */
  parentId: z.uuid().optional(),
  /** Created from a sprint's board, it starts in that sprint (ADR-0029). */
  sprintId: z.uuid().optional()
})
export type CreateCard = z.infer<typeof createCardSchema>

export const updateCardSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(50_000).optional(),
    typeId: z.uuid().optional(),
    stateId: z.uuid().optional(),
    assigneeId: z.uuid().nullable().optional(),
    groupId: z.uuid().nullable().optional(),
    priority: prioritySchema.optional(),
    labels: labelsSchema.optional(),
    dueDate: z.iso.date().nullable().optional(),
    estimate: z.string().trim().max(20).nullable().optional(),
    points: pointsSchema.nullable().optional(),
    /** The sprint the card goes to, of its own space and not closed; `null` sends it to the backlog. */
    sprintId: z.uuid().nullable().optional(),
    parentId: z.uuid().nullable().optional(),
    /** Custom field id → value; `null` clears it (2.5). Only the fields named change. */
    customFields: z.record(z.uuid(), z.unknown()).optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one field to change'
  })
export type UpdateCard = z.infer<typeof updateCardSchema>

/**
 * The same change to many cards at once (escopo-mvp 3.8): a state or a sprint — the cards must share
 * a space, since both are a space's own — an assignee, labels to add and labels to take off.
 */
export const bulkEditSchema = z.object({
  cardIds: z.array(z.uuid()).min(1).max(100),
  changes: z
    .object({
      stateId: z.uuid().optional(),
      assigneeId: z.uuid().nullable().optional(),
      sprintId: z.uuid().nullable().optional(),
      addLabels: labelsSchema.min(1).optional(),
      removeLabels: labelsSchema.min(1).optional()
    })
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
      message: 'Send at least one change'
    })
})
export type BulkEdit = z.infer<typeof bulkEditSchema>

/** Where a card lands on the board: a state, and its position among that state's cards (0 = top). */
export const moveCardSchema = z.object({ stateId: z.uuid(), index: z.number().int().min(0) })
export type MoveCard = z.infer<typeof moveCardSchema>

/** A position in the backlog (3.3): 0 is the top of every card not done or cancelled. */
export const rankInBacklogSchema = z.object({ index: z.number().int().min(0) })

/** To another space (2.14): the card takes a new number there; the old key keeps answering. */
export const transferCardSchema = z.object({
  spaceId: z.uuid(),
  typeId: z.uuid().optional(),
  stateId: z.uuid().optional()
})
export type TransferCard = z.infer<typeof transferCardSchema>
export const cardKeyPathSchema = z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/) })

export const createStateSchema = z.object({ name: z.string().trim().min(1).max(60), group: stateGroupSchema })
export const updateStateSchema = z
  .object({ name: z.string().trim().min(1).max(60).optional(), group: stateGroupSchema.optional() })
  .refine((input) => input.name !== undefined || input.group !== undefined, { message: 'Send a name or a group' })
export const orderStatesSchema = z.object({ stateIds: z.array(z.uuid()).min(1) })
/** A state with cards is deleted by moving its cards somewhere first. */
export const deleteStateQuerySchema = z.object({ moveTo: z.uuid().optional() })

export const reactionViewSchema = z.object({ emoji: z.string(), memberIds: z.array(z.uuid()) })

/** `body` carries mentions as `<@memberId>`; `mentions` names each one, for the screen to show. */
export const commentViewSchema = z.object({
  id: z.uuid(),
  author: personSchema,
  body: z.string(),
  mentions: z.array(personSchema),
  reactions: z.array(reactionViewSchema),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable()
})
export type CommentView = z.infer<typeof commentViewSchema>
export const commentListSchema = z.object({ items: z.array(commentViewSchema) })

/** Who follows a card (2.11). */
export const watcherListSchema = z.object({ items: z.array(z.object({ id: z.uuid(), name: z.string() })) })
export const createCommentSchema = z.object({ body: z.string().trim().min(1).max(20_000) })
export const commentPathSchema = z.object({ cardId: z.uuid(), commentId: z.uuid() })
/** One emoji, as typed: a short string, not a closed list — the screen offers the usual few. */
export const reactSchema = z.object({ emoji: z.string().trim().min(1).max(16), on: z.boolean() })

export const cardPathSchema = z.object({ cardId: z.uuid() })
export const statePathSchema = z.object({ spaceId: z.uuid(), stateId: z.uuid() })

export const toStateView = (row: StateRow) => ({
  id: row.id,
  name: row.name,
  group: stateGroupSchema.parse(row.group),
  position: row.position,
  columnId: row.columnId
})
export const toTypeView = (row: CardTypeRow) => ({
  id: row.id,
  name: row.name,
  icon: typeIconSchema.parse(row.icon),
  color: typeColorSchema.parse(row.color),
  position: row.position,
  isSubtask: row.isSubtask
})

export type CardWithPeople = CardRow & {
  spaceKey: string
  assigneeName: string | null
  reporterName: string
  groupName: string | null
}

export const toCardView = (row: CardWithPeople): CardView => ({
  id: row.id,
  key: `${row.spaceKey}-${row.number}`,
  number: row.number,
  spaceId: row.spaceId,
  typeId: row.typeId,
  stateId: row.stateId,
  title: row.title,
  description: row.description,
  assignee: row.assigneeId && row.assigneeName ? { id: row.assigneeId, name: row.assigneeName } : null,
  reporter: { id: row.reporterId, name: row.reporterName },
  group: row.groupId && row.groupName ? { id: row.groupId, name: row.groupName } : null,
  priority: prioritySchema.parse(row.priority),
  labels: z.array(z.string()).parse(row.labels),
  dueDate: row.dueDate,
  estimate: row.estimate,
  points: row.points,
  sprintId: row.sprintId,
  parentId: row.parentId,
  customFields: z.record(z.string(), z.unknown()).parse(row.customFields),
  rank: row.rank,
  backlogRank: row.backlogRank,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt)
})
