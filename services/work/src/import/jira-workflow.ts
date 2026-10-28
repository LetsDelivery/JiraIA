import { z } from 'zod'

import type { StateGroup } from '../cards/schemas.js'
import { LETS_WORKFLOWS, type WorkflowTemplate } from '../cards/workflow-defaults.js'
import type { IssueRecord, JiraProject } from './atlassian-source.js'
import { groupOf, statusOf, typeNameOf } from './jira-mapping.js'

/**
 * Etapa 8c (ADR-0036, ADR-0037): a project's workflow exactly as Jira has it — every status of every
 * issue type, used or not, and every issue type with its sub-task level. JiraIA's own templates never
 * enter a migrated space.
 */
export type JiraState = { name: string; group: StateGroup }
export type JiraType = { name: string; subtask: boolean }
export type JiraWorkflow = {
  states: JiraState[]
  types: JiraType[]
  /** The statuses of the issue types the board draws (not sub-tasks): a business project's columns. */
  boardStates: string[]
}

const statusesFileSchema = z.array(
  z.looseObject({
    subtask: z.boolean().optional(),
    statuses: z.array(z.looseObject({ name: z.string(), statusCategory: z.looseObject({ key: z.string() }) }))
  })
)
const issueTypesSchema = z.array(z.looseObject({ name: z.string(), subtask: z.boolean().optional() }))

const GROUP_ORDER: Record<StateGroup, number> = { not_started: 0, in_progress: 1, done: 2, cancelled: 3 }

/**
 * Jira's API lists statuses in no useful order: they go from not started to done, and within a group
 * in the order LET'S wrote down for REQ, PRD and TEC (`LETS_WORKFLOWS`), then as Jira listed them.
 */
const ordered = (states: JiraState[], projectKey: string): JiraState[] => {
  const known = (LETS_WORKFLOWS as Record<string, WorkflowTemplate | undefined>)[projectKey]
  const rank = (name: string) => {
    const index = known?.states.findIndex(([each]) => each === name) ?? -1
    return index === -1 ? 1_000 : index
  }
  return states
    .map((state, seen) => ({ state, seen }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.state.group] - GROUP_ORDER[b.state.group] ||
        rank(a.state.name) - rank(b.state.name) ||
        a.seen - b.seen
    )
    .map((entry) => entry.state)
}

/** Each name once, as it first appears: what Jira declares wins over what a card shows. */
const unique = <T extends { name: string }>(items: T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => !seen.has(item.name) && seen.add(item.name) !== undefined)
}

export const jiraWorkflowOf = (project: JiraProject, statusesFile: unknown, records: IssueRecord[]): JiraWorkflow => {
  const perType = statusesFileSchema.parse(statusesFile ?? [])
  const declared = perType.flatMap((type) =>
    type.statuses.map((status) => ({ name: status.name, group: groupOf(status.statusCategory.key) }))
  )
  const used = records.map(statusOf)
  const issueTypes = issueTypesSchema.parse(project.issueTypes ?? [])
  const types = unique([
    ...issueTypes.map((type) => ({ name: type.name, subtask: type.subtask === true })),
    ...records.map((record) => ({ name: typeNameOf(record), subtask: false }))
  ])
  const subtaskNames = new Set(types.filter((type) => type.subtask).map((type) => type.name))
  const onBoard = perType
    .filter((type) => type.subtask !== true)
    .flatMap((type) => type.statuses.map((status) => status.name))
  const usedOnBoard = records
    .filter((record) => !subtaskNames.has(typeNameOf(record)))
    .map((record) => statusOf(record).name)
  const states = ordered(unique([...declared, ...used]), project.key)
  const boardNames = new Set([...onBoard, ...usedOnBoard])
  return { states, types, boardStates: states.map((state) => state.name).filter((name) => boardNames.has(name)) }
}
