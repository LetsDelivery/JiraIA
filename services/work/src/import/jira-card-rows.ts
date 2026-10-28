import { parseFieldValue } from '../cards/field.schemas.js'
import { mentionedIds } from '../cards/mentions.js'
import { adfToMarkdown } from './adf-markdown.js'
import type { IssueRecord, Raw } from './atlassian-source.js'
import type { CardInsert, CommentInsert } from './import.repository.js'
import type { Catalogue } from './import-catalogue.js'
import type { People } from './import-members.js'
import {
  currentSprintOf,
  dueDateOf,
  fieldsOf,
  fieldValueOf,
  labelsOf,
  numberOf,
  priorityOf,
  sprintsOf,
  statusOf,
  typeNameOf,
  userOf
} from './jira-mapping.js'

/** What a card row needs besides the issue: where it goes, who is who, and its place on the board. */
export type CardContext = {
  organizationId: string
  catalogue: Catalogue
  people: People
  /** Whoever runs the import: the reporter of an issue that names nobody. */
  actorId: string
  storyPointsField: string | undefined
  sprintField: string | undefined
}

export const mentionOf =
  (people: People) =>
  (accountId: string): string | undefined => {
    const member = people.memberOf(accountId)
    return member ? `<@${member}>` : undefined
  }

const markdownOf = (people: People) => (document: unknown) => adfToMarkdown(document, { mention: mentionOf(people) })

const memberIn = (people: People, value: unknown): string | undefined => {
  const user = userOf(value)
  return user ? people.memberOf(user.accountId) : undefined
}

/** The custom fields a card fills in; a value JiraIA's field would refuse stays in the raw copy only. */
const customFieldsOf = (record: IssueRecord, context: CardContext): Record<string, unknown> => {
  const values: Record<string, unknown> = {}
  for (const field of context.catalogue.fields) {
    const value = fieldValueOf(
      field.kind,
      fieldsOf(record)[field.jiraId],
      context.people.memberOf,
      markdownOf(context.people)
    )
    try {
      values[field.id] = value === undefined ? undefined : parseFieldValue(field, value)
    } catch {
      values[field.id] = undefined
    }
  }
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

const pointsOf = (record: IssueRecord, field: string | undefined): number | null => {
  const value = field ? fieldsOf(record)[field] : undefined
  return typeof value === 'number' ? value : null
}

/** The sprint a card is in now (`currentSprintOf`), as the space's sprint. */
const sprintOf = (record: IssueRecord, context: CardContext): string | null => {
  const current = currentSprintOf(sprintsOf(record, context.sprintField))
  return current ? (context.catalogue.sprintId.get(current.id) ?? null) : null
}

/** A Jira issue as a JiraIA card, with Jira's own number, authors and dates; parents come in a second pass. */
export const cardRowOf = (
  record: IssueRecord,
  context: CardContext,
  place: { id: string; rank: number; backlogRank: number }
): CardInsert => {
  const fields = fieldsOf(record)
  return {
    id: place.id,
    organizationId: context.organizationId,
    spaceId: context.catalogue.spaceId,
    number: numberOf(String(record.issue.key)),
    typeId: context.catalogue.typeId.get(typeNameOf(record)) ?? '',
    stateId: context.catalogue.stateId.get(statusOf(record).name) ?? '',
    title: String(fields.summary ?? '').slice(0, 255),
    description: markdownOf(context.people)(fields.description),
    assigneeId: memberIn(context.people, fields.assignee) ?? null,
    reporterId:
      memberIn(context.people, fields.reporter) ?? memberIn(context.people, fields.creator) ?? context.actorId,
    priority: priorityOf(record),
    labels: labelsOf(record),
    dueDate: dueDateOf(record),
    points: pointsOf(record, context.storyPointsField),
    sprintId: sprintOf(record, context),
    customFields: customFieldsOf(record, context),
    rank: place.rank,
    backlogRank: place.backlogRank,
    createdAt: new Date(String(fields.created)),
    updatedAt: new Date(String(fields.updated))
  }
}

/** A Jira comment as a JiraIA comment: its author, Markdown body, date and, if edited, the edit's date. */
export const commentRowOf = (comment: Raw, cardId: string, id: string, context: CardContext): CommentInsert => {
  const body = markdownOf(context.people)(comment.body)
  const created = new Date(String(comment.created))
  const updated = new Date(String(comment.updated ?? comment.created))
  return {
    id,
    cardId,
    authorId: memberIn(context.people, comment.author) ?? context.actorId,
    body,
    mentions: mentionedIds(body),
    createdAt: created,
    editedAt: updated.getTime() > created.getTime() ? updated : null
  }
}
