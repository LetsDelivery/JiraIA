import type { Changes, FieldChange } from '../audit/audit.js'
import type { LinkType } from '../cards/link.schemas.js'
import type { Raw } from './atlassian-source.js'

/**
 * Etapa 8d (ADR-0036): one item of a Jira changelog as the change JiraIA's audit trail would have
 * written — the same keys (`stateId`, `assigneeId`, `field:<id>`…) and ids, so the card's history, the
 * reports that read entries into a state (ADR-0016) and the sprint reports see Jira's past as their own.
 */
export type HistoryNames = {
  stateId: (name: string) => string | undefined
  typeId: (name: string) => string | undefined
  memberOf: (accountId: string) => string | undefined
  sprintId: (jiraSprintId: number) => string | undefined
  cardId: (issueId: string) => string | undefined
  /** A custom field Jira's id names, as the space's field id. */
  fieldId: (jiraFieldId: string) => string | undefined
  storyPointsField: string | undefined
  sprintField: string | undefined
  /** The board's order (Jira's Rank, named in the site's language): noise, whatever it is called. */
  rankField: string | undefined
}

/** The action a change belongs to: most are `updated`; a state change is `moved`, as the board writes it. */
export type HistoryAction = 'updated' | 'moved' | 'transferred' | 'linked' | 'unlinked' | 'attached' | 'detached'
export type HistoryChange = { action: HistoryAction; key: string; change: FieldChange }

/** Fields whose change Jira records but nobody reads back: the board's order, the dev panel. */
const NOISE = new Set(['Rank', 'development', 'WorklogId', 'timespent', 'timeestimate', 'Workflow'])

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const change = (before: unknown, after: unknown): FieldChange => ({ before: before ?? null, after: after ?? null })

/** Jira's "261, 327, 360" as its last sprint: the one the card moved to or stayed in. */
const lastSprint = (ids: unknown, names: HistoryNames): string | null => {
  const last = text(ids)?.split(',').at(-1)?.trim()
  return last ? (names.sprintId(Number(last)) ?? null) : null
}

const priority = (value: unknown): string | null => text(value)?.toLowerCase() ?? null
const labels = (value: unknown): string[] => text(value)?.split(' ').filter(Boolean) ?? []

/** "This work item is blocked by TEC-12" as JiraIA's link type; anything unknown relates. */
const linkTypeOf = (phrase: string): LinkType => {
  const rules: [RegExp, LinkType][] = [
    [/implement/i, 'delivers'],
    [/block/i, 'blocks'],
    [/duplicat/i, 'duplicates'],
    [/caus/i, 'causes']
  ]
  return rules.find(([pattern]) => pattern.test(phrase))?.[1] ?? 'relates'
}

type Rule = (item: Raw, names: HistoryNames, key: string) => HistoryChange | null

const RULES: Record<string, Rule> = {
  status: (item, names) => ({
    action: 'moved',
    key: 'stateId',
    change: change(names.stateId(String(item.fromString)), names.stateId(String(item.toString)))
  }),
  assignee: (item, names) => ({
    action: 'updated',
    key: 'assigneeId',
    change: change(names.memberOf(String(item.from)), names.memberOf(String(item.to)))
  }),
  summary: (item) => ({ action: 'updated', key: 'title', change: change(text(item.fromString), text(item.toString)) }),
  description: (item) => ({
    action: 'updated',
    key: 'description',
    change: change(text(item.fromString) ? 'texto' : null, text(item.toString) ? 'texto' : null)
  }),
  priority: (item) => ({
    action: 'updated',
    key: 'priority',
    change: change(priority(item.fromString), priority(item.toString))
  }),
  labels: (item) => ({
    action: 'updated',
    key: 'labels',
    change: change(labels(item.fromString), labels(item.toString))
  }),
  duedate: (item) => ({ action: 'updated', key: 'dueDate', change: change(text(item.from), text(item.to)) }),
  issuetype: (item, names) => ({
    action: 'updated',
    key: 'typeId',
    change: change(names.typeId(String(item.fromString)), names.typeId(String(item.toString)))
  }),
  IssueParentAssociation: (item, names) => ({
    action: 'updated',
    key: 'parentId',
    change: change(names.cardId(String(item.from)), names.cardId(String(item.to)))
  }),
  Key: (item) => ({ action: 'transferred', key: 'key', change: change(text(item.fromString), text(item.toString)) }),
  Attachment: (item) => ({
    action: item.to ? 'attached' : 'detached',
    key: 'attachment',
    change: change(text(item.fromString), text(item.toString))
  }),
  Link: (item, _names, key) => {
    const phrase = String(item.toString ?? item.fromString ?? '')
    const other = text(item.to) ?? text(item.from)
    const value = { type: linkTypeOf(phrase), from: key, to: other }
    return item.to
      ? { action: 'linked', key: 'link', change: change(null, value) }
      : { action: 'unlinked', key: 'link', change: change(value, null) }
  }
}

/** A custom field: story points and the sprint have homes of their own; the rest are the space's fields. */
const customChange = (item: Raw, names: HistoryNames): HistoryChange | null => {
  const id = String(item.fieldId)
  if (id === names.sprintField) {
    return {
      action: 'updated',
      key: 'sprintId',
      change: change(lastSprint(item.from, names), lastSprint(item.to, names))
    }
  }
  if (id === names.storyPointsField) {
    const points = (value: unknown) => (text(value) === null ? null : Number(value))
    return { action: 'updated', key: 'points', change: change(points(item.fromString), points(item.toString)) }
  }
  const fieldId = names.fieldId(id)
  return fieldId
    ? { action: 'updated', key: `field:${fieldId}`, change: change(text(item.fromString), text(item.toString)) }
    : null
}

/**
 * One changelog item as a JiraIA change, or `null` for noise. What JiraIA has no field for keeps its
 * words under `jira:<Jira's field name>`, so nothing Jira recorded is dropped.
 */
export const historyChangeOf = (item: Raw, names: HistoryNames, cardKey: string): HistoryChange | null => {
  const field = String(item.field)
  if (NOISE.has(field) || field === 'project' || (item.fieldId !== undefined && item.fieldId === names.rankField)) {
    return null
  }
  const rule = RULES[field]
  if (rule) {
    return rule(item, names, cardKey)
  }
  if (item.fieldtype === 'custom') {
    const custom = customChange(item, names)
    if (custom) {
      return custom
    }
  }
  return { action: 'updated', key: `jira:${field}`, change: change(text(item.fromString), text(item.toString)) }
}

/** A changelog entry's items, grouped by the action each belongs to: one audit event per action. */
export const historyEventsOf = (
  items: Raw[],
  names: HistoryNames,
  cardKey: string
): { action: HistoryAction; changes: Changes }[] => {
  const byAction = new Map<HistoryAction, Changes>()
  for (const item of items) {
    const found = historyChangeOf(item, names, cardKey)
    if (found) {
      byAction.set(found.action, { ...(byAction.get(found.action) ?? {}), [found.key]: found.change })
    }
  }
  return [...byAction].map(([action, changes]) => ({ action, changes }))
}
