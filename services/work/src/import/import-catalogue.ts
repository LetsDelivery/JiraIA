import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { eq } from 'drizzle-orm'
import type { FieldKind } from '../cards/field.schemas.js'

import { customFields, spaces, sprints } from '../schema.js'
import type { IssueRecord, JiraProject } from './atlassian-source.js'
import type { ImportRepository } from './import.repository.js'
import type { People } from './import-members.js'
import { ImportWorkflow, type WorkflowReconciliation } from './import-workflow.js'
import {
  dayOf,
  fieldsOf,
  isSprint,
  isStoryPoints,
  type JiraField,
  type JiraSprint,
  kindOf,
  sprintStateOf,
  sprintsOf
} from './jira-mapping.js'
import type { JiraWorkflow } from './jira-workflow.js'

/** Where a project's cards go: the space and the ids of its states, types, fields and sprints. */
export type Catalogue = {
  spaceId: string
  stateId: Map<string, string>
  typeId: Map<string, string>
  /** What the space had that Jira has not: removed, or kept off the board because something names it. */
  reconciliation: WorkflowReconciliation
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
  workflow: JiraWorkflow
  at: Date
}

const SPACE_TYPES = ['software', 'business', 'product_discovery', 'service_desk']
const MAX_OPTIONS = 100

/**
 * How the space plans, as its Jira project did: in sprints when a card was in one, and in story points
 * when a card was estimated in them (ADR-0029). It only turns these on, never off.
 */
const planningOf = (input: Input): { usesSprints?: true; estimation?: 'points' } => {
  const sprintField = input.jiraFields.find(isSprint)?.id
  const pointsField = input.jiraFields.find(isStoryPoints)?.id
  const sprinted = input.records.some((record) => sprintsOf(record, sprintField).length > 0)
  const pointed =
    pointsField !== undefined && input.records.some((record) => typeof fieldsOf(record)[pointsField] === 'number')
  return { ...(sprinted ? { usesSprints: true } : {}), ...(pointed ? { estimation: 'points' } : {}) }
}

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
    const workflow = await new ImportWorkflow(this.deps).apply(spaceId, input.workflow, input.at)
    return {
      spaceId,
      stateId: workflow.stateId,
      typeId: workflow.typeId,
      reconciliation: workflow.reconciliation,
      fields: await this.fields(spaceId, input),
      sprintId: await this.sprints(spaceId, input)
    }
  }

  private async space(input: Input): Promise<string> {
    const found = await this.deps.repository.spaceByKey(input.organizationId, input.project.key)
    const id = found?.id ?? (await this.createSpace(input))
    const planning = planningOf(input)
    if (Object.keys(planning).length > 0) {
      await this.deps.db.update(spaces).set(planning).where(eq(spaces.id, id))
    }
    return id
  }

  private async createSpace(input: Input): Promise<string> {
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

  /** Custom fields the project's cards fill in, with the options their values use. */
  private async fields(spaceId: string, input: Input): Promise<Catalogue['fields']> {
    const existing = await this.deps.repository.fields(spaceId)
    const used = input.jiraFields
      .map((field) => ({ field, kind: kindOf(field) }))
      .filter((entry): entry is { field: JiraField; kind: FieldKind } => entry.kind !== undefined)
      .filter((entry) => input.records.some((record) => fieldsOf(record)[entry.field.id] != null))
    const result: Catalogue['fields'] = []
    const names = fieldNames(used.map((entry) => entry.field))
    for (const [position, { field, kind }] of used.entries()) {
      const options = optionsOf(input.records, field.id, kind)
      const name = names.get(field.id) ?? field.name
      const found = existing.find((row) => row.name === name)
      const id = found?.id ?? this.deps.ids.next()
      if (!found) {
        await this.deps.db.insert(customFields).values({
          id,
          spaceId,
          name,
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
        name,
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

/**
 * Each field's name in the space, unique as JiraIA requires: Jira allows two fields of one name ("Link"
 * twice), so a repeated one is told apart by its Jira number, the same on every run.
 */
const fieldNames = (fields: JiraField[]): Map<string, string> => {
  const taken = new Set<string>()
  const names = new Map<string, string>()
  for (const field of fields) {
    const plain = field.name.slice(0, 60)
    const name = taken.has(plain) ? `${field.name.slice(0, 45)} (${field.id.replace('customfield_', '')})` : plain
    taken.add(name)
    names.set(field.id, name)
  }
  return names
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
