import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { eq } from 'drizzle-orm'

import { lookOf } from '../cards/card-type.schemas.js'
import { cardTypes, workflowStates } from '../schema.js'
import type { ImportRepository } from './import.repository.js'
import type { JiraWorkflow } from './jira-workflow.js'

/** What a space's workflow had that Jira's has not: removed, or kept because something still names it. */
export type WorkflowReconciliation = { removed: string[]; kept: string[] }
export type WorkflowIds = {
  stateId: Map<string, string>
  typeId: Map<string, string>
  reconciliation: WorkflowReconciliation
}

type Deps = { db: Database; repository: ImportRepository; ids: IdGenerator }
type Row = { id: string; name: string }

/**
 * Etapa 8c (ADR-0036, ADR-0037): makes a space's states and card types exactly the project's in Jira, in
 * Jira's order. What Jira lacks is removed when nothing names it; a state or type still named — by a
 * card created in JiraIA, a form, an automation — is kept, off the board, and reported.
 */
export class ImportWorkflow {
  constructor(private readonly deps: Deps) {}

  async apply(spaceId: string, workflow: JiraWorkflow, at: Date): Promise<WorkflowIds> {
    const reconciliation: WorkflowReconciliation = { removed: [], kept: [] }
    const stateId = await this.states(spaceId, workflow, at, reconciliation)
    const typeId = await this.types(spaceId, workflow, at, reconciliation)
    return { stateId, typeId, reconciliation }
  }

  private async states(spaceId: string, workflow: JiraWorkflow, at: Date, report: WorkflowReconciliation) {
    const existing = await this.deps.repository.states(spaceId)
    const ids = new Map(existing.map((state) => [state.name, state.id]))
    for (const [position, state] of workflow.states.entries()) {
      const id = ids.get(state.name)
      if (id) {
        await this.deps.db.update(workflowStates).set({ group: state.group, position }).where(eq(workflowStates.id, id))
      } else {
        const row = { id: this.deps.ids.next(), spaceId, name: state.name, group: state.group, position, createdAt: at }
        await this.deps.db.insert(workflowStates).values(row)
        ids.set(state.name, row.id)
      }
    }
    const extra = existing.filter((state) => !workflow.states.some((wanted) => wanted.name === state.name))
    await this.reconcile(extra, 'state', report, workflow.states.length)
    return ids
  }

  private async types(spaceId: string, workflow: JiraWorkflow, at: Date, report: WorkflowReconciliation) {
    const existing = await this.deps.repository.types(spaceId)
    const ids = new Map(existing.map((type) => [type.name, type.id]))
    for (const [position, type] of workflow.types.entries()) {
      const id = ids.get(type.name)
      if (id) {
        await this.deps.db.update(cardTypes).set({ isSubtask: type.subtask, position }).where(eq(cardTypes.id, id))
      } else {
        const row = {
          id: this.deps.ids.next(),
          spaceId,
          name: type.name,
          ...lookOf(type.name),
          isSubtask: type.subtask,
          position,
          createdAt: at
        }
        await this.deps.db.insert(cardTypes).values(row)
        ids.set(type.name, row.id)
      }
    }
    const extra = existing.filter((type) => !workflow.types.some((wanted) => wanted.name === type.name))
    await this.reconcile(extra, 'type', report, workflow.types.length)
    return ids
  }

  /** Removes what nothing names; keeps the rest after Jira's, and reports both. */
  private async reconcile(extra: Row[], kind: 'state' | 'type', report: WorkflowReconciliation, after: number) {
    const table = kind === 'state' ? workflowStates : cardTypes
    for (const [offset, row] of extra.entries()) {
      if (await this.deps.repository.isNamed(row.id, kind)) {
        await this.deps.db
          .update(table)
          .set({ position: after + offset })
          .where(eq(table.id, row.id))
        report.kept.push(`${kind} ${row.name}`)
      } else {
        await this.deps.db.delete(table).where(eq(table.id, row.id))
        report.removed.push(`${kind} ${row.name}`)
      }
    }
  }
}
