import { createHash } from 'node:crypto'

import type { FieldKind } from '../cards/field.schemas.js'
import type { Priority, StateGroup } from '../cards/schemas.js'
import type { IssueRecord, Raw } from './atlassian-source.js'

/**
 * Etapa 8c (ADR-0036): what a Jira issue says, in JiraIA's words. Pure functions over the raw copy;
 * `jira-import.ts` writes what they answer.
 */
export type JiraField = { id: string; name: string; custom?: boolean; schema?: { type?: string; custom?: string } }
export type JiraUser = { accountId: string; displayName?: string }
export type JiraSprint = {
  id: number
  name: string
  state: string
  goal?: string
  startDate?: string
  endDate?: string
  completeDate?: string
}

const obj = (value: unknown): Raw => (value !== null && typeof value === 'object' ? (value as Raw) : {})
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const fieldsOf = (record: IssueRecord): Raw => obj(record.issue.fields)

/** `TEC-3538` → 3538. */
export const numberOf = (key: string): number => Number(key.slice(key.lastIndexOf('-') + 1))

/** Jira's three status categories, as JiraIA's state groups. */
export const groupOf = (category: string): StateGroup =>
  category === 'done' ? 'done' : category === 'indeterminate' ? 'in_progress' : 'not_started'

export const statusOf = (record: IssueRecord): { name: string; group: StateGroup } => {
  const status = obj(fieldsOf(record).status)
  return { name: text(status.name), group: groupOf(text(obj(status.statusCategory).key)) }
}

export const typeNameOf = (record: IssueRecord): string => text(obj(fieldsOf(record).issuetype).name)

const PRIORITIES: Record<string, Priority> = {
  highest: 'highest',
  high: 'high',
  medium: 'medium',
  low: 'low',
  lowest: 'lowest'
}

/** Jira's five priorities are JiraIA's; anything else (or none) is medium, Jira's own default. */
export const priorityOf = (record: IssueRecord): Priority =>
  PRIORITIES[text(obj(fieldsOf(record).priority).name).toLowerCase()] ?? 'medium'

export const userOf = (value: unknown): JiraUser | undefined => {
  const user = obj(value)
  return typeof user.accountId === 'string'
    ? { accountId: user.accountId, displayName: text(user.displayName) }
    : undefined
}

export const labelsOf = (record: IssueRecord): string[] =>
  (Array.isArray(fieldsOf(record).labels) ? (fieldsOf(record).labels as unknown[]) : []).map(String)

export const dueDateOf = (record: IssueRecord): string | null => {
  const due = text(fieldsOf(record).duedate)
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null
}

export const parentKeyOf = (record: IssueRecord): string | undefined => {
  const key = obj(fieldsOf(record).parent).key
  return typeof key === 'string' ? key : undefined
}

/** Every key the issue had before, from the `Key` items of its changelog: `LD-17` for `TEC-216`. */
export const formerKeysOf = (record: IssueRecord): string[] =>
  record.changelog
    .flatMap((entry) => (Array.isArray(entry.items) ? (entry.items as Raw[]) : []))
    .filter((item) => item.field === 'Key' && typeof item.fromString === 'string')
    .map((item) => String(item.fromString))

/** The calendar day an instant falls on in São Paulo, where LET'S reads every date. */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
export const dayOf = (instant: string): string | null => {
  const at = new Date(instant)
  return Number.isNaN(at.getTime()) ? null : DAY.format(at)
}

/**
 * Which rules wrote a row. Raised whenever the mapping changes what a row holds, so the next run
 * writes every row again instead of skipping those whose source did not change. 2: a card's sprint is
 * its active one, not the last Jira lists.
 */
export const IMPORTER_VERSION = 2

/** A stable fingerprint of a raw record under these rules: a later run skips the rows it already wrote. */
export const hashOf = (value: unknown): string =>
  createHash('sha256')
    .update(`${IMPORTER_VERSION}:${JSON.stringify(value)}`)
    .digest('hex')

/** Jira's own field kinds that become a JiraIA field kind; the rest stay in the raw copy only. */
const KINDS: Record<string, FieldKind> = {
  select: 'select',
  radiobuttons: 'select',
  multiselect: 'multi_select',
  multicheckboxes: 'multi_select',
  datetime: 'date',
  datepicker: 'date',
  url: 'url',
  float: 'number',
  textfield: 'text',
  textarea: 'text',
  userpicker: 'person'
}

/** Fields JiraIA holds elsewhere (rank, sprint, points) or not at all (the development panel). */
const HELD_ELSEWHERE = /gh-lexo-rank|gh-sprint|jsw-story-points|devsummarycf/

const shortKind = (field: JiraField): string => text(field.schema?.custom).split(':').pop() ?? ''

export const kindOf = (field: JiraField): FieldKind | undefined =>
  field.custom && !HELD_ELSEWHERE.test(text(field.schema?.custom)) ? KINDS[shortKind(field)] : undefined

export const isStoryPoints = (field: JiraField): boolean => shortKind(field) === 'jsw-story-points'
export const isSprint = (field: JiraField): boolean => shortKind(field) === 'gh-sprint'
export const isRank = (field: JiraField): boolean => shortKind(field) === 'gh-lexo-rank'

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || (Array.isArray(value) && value.length === 0)

/** A Jira field value as the JiraIA kind holds it; `undefined` when there is none. */
export const fieldValueOf = (
  kind: FieldKind,
  value: unknown,
  person: (accountId: string) => string | undefined,
  markdown: (document: unknown) => string
): unknown => {
  if (isEmpty(value)) {
    return undefined
  }
  const convert: Record<FieldKind, () => unknown> = {
    select: () => text(obj(value).value) || undefined,
    multi_select: () => (value as Raw[]).map((option) => text(obj(option).value)).filter(Boolean),
    date: () => (/^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? value : dayOf(text(value))) ?? undefined,
    url: () => text(value) || undefined,
    number: () => (typeof value === 'number' ? value : undefined),
    text: () => (typeof value === 'string' ? value : markdown(value)) || undefined,
    person: () => (userOf(value) ? person((userOf(value) as JiraUser).accountId) : undefined)
  }
  return convert[kind]()
}

/** Jira's sprint states, as JiraIA's (ADR-0029). */
export const sprintStateOf = (state: string): 'planned' | 'active' | 'closed' =>
  state === 'closed' ? 'closed' : state === 'active' ? 'active' : 'planned'

export const sprintsOf = (record: IssueRecord, sprintFieldId: string | undefined): JiraSprint[] => {
  const value = sprintFieldId ? fieldsOf(record)[sprintFieldId] : undefined
  return Array.isArray(value) ? (value as JiraSprint[]).filter((sprint) => typeof sprint?.id === 'number') : []
}

const STATE_ORDER: Record<string, number> = { active: 0, future: 1 }

/**
 * The sprint a card is in now. Jira lists every sprint a card went through, not in time order: the
 * active one first, then a future one, then the closed one that ended last.
 */
export const currentSprintOf = (sprints: JiraSprint[]): JiraSprint | undefined =>
  [...sprints].sort((a, b) => {
    const byState = (STATE_ORDER[a.state] ?? 2) - (STATE_ORDER[b.state] ?? 2)
    const ended = (sprint: JiraSprint) => sprint.completeDate ?? sprint.endDate ?? sprint.startDate ?? ''
    return byState !== 0 ? byState : ended(b).localeCompare(ended(a))
  })[0]

/** Splits rows into batches small enough for one Data API statement. */
export const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
