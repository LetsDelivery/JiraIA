import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { lookOf } from '../cards/card-type.schemas.js'
import type { FieldKind } from '../cards/field.schemas.js'
import type { StateGroup } from '../cards/schemas.js'
import { cardTypes, customFields, spaces, sprints, workflowStates } from '../schema.js'
import type { IssueRecord, JiraProject } from './atlassian-source.js'
import type { ImportRepository } from './import.repository.js'
import type { People } from './import-members.js'
import {
  dayOf,
  fieldsOf,
  type JiraField,
  type JiraSprint,
  kindOf,
  sprintStateOf,
  sprintsOf,
  statusOf,
  typeNameOf
} from './jira-mapping.js'

/** Where a project's cards go: the space and the ids of its states, types, fields and sprints. */
export type Catalogue = {
  spaceId: string
  stateId: Map<string, string>
  typeId: Map<string, string>
  fields: { jiraId: string; id: string; name: string; kind: FieldKind; options: string[] }[]
  sprintId: Map<number, string>
}

type Deps = { db: Database; repository: ImportRepository; ids: IdGenerator }
type Input = {
  organizationId: string
  project: JiraProject
  records: IssueRecord[]
  jiraFields: JiraField[]
  people: People
  at: Date
}

const SPACE_TYPES = ['software', 'business', 'product_discovery', 'service_desk']
const MAX_OPTIONS = 100

/** Statuses in the order cards first used them, each once, with Jira's category as the group. */
const statusesOf = (records: IssueRecord[]): { name: string; group: StateGroup }[] => [
  ...new Map(records.map((record) => statusOf(record)).map((status) => [status.name, status])).values()
]

const earliest = (records: IssueRecord[], at: Date): Date =>
  records.map((record) => new Date(String(fieldsOf(record).created))).reduce((a, b) => (b < a ? b : a), at)

/**
 * Etapa 8c (ADR-0036): makes sure the project's space exists with every status, type, field and sprint
 * its cards use, adding only what is missing — an existing space keeps its own states and gains Jira's.
 */
export class ImportCatalogue {
  constructor(private readonly deps: Deps) {}

  async ensure(input: Input): Promise<Catalogue> {
    const spaceId = await this.space(input)
    return {
      spaceId,
      stateId: await this.states(spaceId, statusesOf(input.records), input.at),
      typeId: await this.types(spaceId, [...new Set(input.records.map(typeNameOf))], input.at),
      fields: await this.fields(spaceId, input),
      sprintId: await this.sprints(spaceId, input)
    }
  }

  private async space(input: Input): Promise<string> {
    const found = await this.deps.repository.spaceByKey(input.organizationId, input.project.key)
    if (found) {
      return found.id
    }
    const id = this.deps.ids.next()
    const type = String(input.project.projectTypeKey ?? 'software')
    const lead = (input.project.lead as { accountId?: string } | undefined)?.accountId
    await this.deps.db.insert(spaces).values({
      id,
      organizationId: input.organizationId,
      key: input.project.key,
      name: input.project.name,
      description: String(input.project.description ?? ''),
      type: SPACE_TYPES.includes(type) ? type : 'software',
      leadId: lead ? (input.people.memberOf(lead) ?? null) : null,
      createdAt: earliest(input.records, input.at)
    })
    return id
  }

  private async states(spaceId: string, wanted: { name: string; group: StateGroup }[], at: Date) {
    const existing = await this.deps.repository.states(spaceId)
    const byName = new Map(existing.map((state) => [state.name, state.id]))
    const missing = wanted.filter((state) => !byName.has(state.name))
    const rows = missing.map((state, index) => ({
      id: this.deps.ids.next(),
      spaceId,
      name: state.name,
      group: state.group,
      position: existing.length + index,
      createdAt: at
    }))
    if (rows.length > 0) {
      await this.deps.db.insert(workflowStates).values(rows)
    }
    return new Map([...byName, ...rows.map((row) => [row.name, row.id] as const)])
  }

  private async types(spaceId: string, wanted: string[], at: Date) {
    const existing = await this.deps.repository.types(spaceId)
    const byName = new Map(existing.map((type) => [type.name, type.id]))
    const rows = wanted
      .filter((name) => !byName.has(name))
      .map((name, index) => ({
        id: this.deps.ids.next(),
        spaceId,
        name,
        ...lookOf(name),
        position: existing.length + index,
        createdAt: at
      }))
    if (rows.length > 0) {
      await this.deps.db.insert(cardTypes).values(rows)
    }
    return new Map([...byName, ...rows.map((row) => [row.name, row.id] as const)])
  }

  /** Custom fields the project's cards fill in, with the options their values use. */
  private async fields(spaceId: string, input: Input): Promise<Catalogue['fields']> {
    const existing = await this.deps.repository.fields(spaceId)
    const used = input.jiraFields
      .map((field) => ({ field, kind: kindOf(field) }))
      .filter((entry): entry is { field: JiraField; kind: FieldKind } => entry.kind !== undefined)
      .filter((entry) => input.records.some((record) => fieldsOf(record)[entry.field.id] != null))
    const result: Catalogue['fields'] = []
    for (const [position, { field, kind }] of used.entries()) {
      const options = optionsOf(input.records, field.id, kind)
      const found = existing.find((row) => row.name === field.name.slice(0, 60))
      const id = found?.id ?? this.deps.ids.next()
      if (!found) {
        await this.deps.db.insert(customFields).values({
          id,
          spaceId,
          name: field.name.slice(0, 60),
          kind,
          options,
          typeIds: [],
          position: existing.length + position,
          createdAt: input.at
        })
      }
      result.push({
        jiraId: field.id,
        id,
        name: field.name,
        kind: (found?.kind as FieldKind | undefined) ?? kind,
        options: found ? (found.options as string[]) : options
      })
    }
    return result
  }

  /**
   * Every sprint a card was in, numbered as Jira named it ("Sprint 32" is 32) when that is free. A space
   * holds one active sprint (ADR-0029): Jira's active one waits as planned when the space has its own.
   */
  private async sprints(spaceId: string, input: Input): Promise<Map<number, string>> {
    const sprintField = input.jiraFields.find((field) => String(field.schema?.custom).endsWith(':gh-sprint'))?.id
    const all = new Map(
      input.records.flatMap((record) => sprintsOf(record, sprintField)).map((sprint) => [sprint.id, sprint])
    )
    const known = await this.deps.repository.refs(input.organizationId, 'jira', 'sprint')
    const result = new Map(
      [...all.keys()].filter((id) => known.has(String(id))).map((id) => [id, known.get(String(id))?.targetId ?? ''])
    )
    const existing = await this.deps.repository.sprints(spaceId)
    const taken = new Set(existing.map((sprint) => sprint.number))
    let activeFree = !existing.some((sprint) => sprint.state === 'active')
    const rows = [...all.values()]
      .filter((sprint) => !result.has(sprint.id))
      .map((sprint) => {
        const row = this.sprintRow(spaceId, input, sprint, taken)
        if (row.insert.state === 'active' && !activeFree) {
          row.insert.state = 'planned'
        }
        activeFree = activeFree && row.insert.state !== 'active'
        return row
      })
    if (rows.length > 0) {
      await this.deps.db.transaction(async (tx) => {
        await tx.insert(sprints).values(rows.map((row) => row.insert))
        await this.deps.repository.putRefs(
          tx,
          rows.map((row) => ({
            organizationId: input.organizationId,
            source: 'jira',
            entity: 'sprint',
            sourceId: String(row.jiraId),
            targetId: row.insert.id,
            contentHash: '',
            runId: 'catalogue',
            importedAt: input.at
          }))
        )
      })
    }
    return new Map([...result, ...rows.map((row) => [row.jiraId, row.insert.id] as const)])
  }

  private sprintRow(spaceId: string, input: Input, sprint: JiraSprint, taken: Set<number>) {
    const insert = {
      id: this.deps.ids.next(),
      organizationId: input.organizationId,
      spaceId,
      number: sprintNumber(sprint.name, taken),
      name: sprint.name.slice(0, 120),
      goal: sprint.goal ?? '',
      state: sprintStateOf(sprint.state),
      ...sprintDays(sprint, input.at),
      startedAt: instant(sprint.startDate),
      closedAt: instant(sprint.completeDate),
      createdAt: instant(sprint.startDate) ?? input.at
    }
    return { jiraId: sprint.id, insert }
  }
}

const instant = (value: string | undefined): Date | null => (value ? new Date(value) : null)

/** "Sprint 32" is number 32 when that is free; otherwise the next after the highest. */
const sprintNumber = (name: string, taken: Set<number>): number => {
  const named = Number(/(\d+)\s*$/.exec(name)?.[1])
  const number = Number.isInteger(named) && !taken.has(named) ? named : Math.max(0, ...taken) + 1
  taken.add(number)
  return number
}

/** Calendar days in São Paulo; a future sprint with no dates yet starts and ends on the import day. */
const sprintDays = (sprint: JiraSprint, at: Date): { startsOn: string; endsOn: string } => {
  const today = dayOf(at.toISOString()) ?? '1970-01-01'
  const start = sprint.startDate ? dayOf(sprint.startDate) : null
  const end = sprint.endDate ? dayOf(sprint.endDate) : null
  return { startsOn: start ?? today, endsOn: end ?? start ?? today }
}

/** The distinct values a selection field takes across the cards, within JiraIA's limits. */
const optionsOf = (records: IssueRecord[], fieldId: string, kind: FieldKind): string[] => {
  if (kind !== 'select' && kind !== 'multi_select') {
    return []
  }
  const values = records.flatMap((record) => [fieldsOf(record)[fieldId]].flat())
  const names = values.map((value) =>
    String((value as { value?: unknown } | null)?.value ?? '')
      .trim()
      .slice(0, 60)
  )
  return [...new Set(names.filter(Boolean))].slice(0, MAX_OPTIONS)
}
