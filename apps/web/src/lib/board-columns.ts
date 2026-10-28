import type { State, Workflow } from '@/api/requests'

/**
 * What the board draws as one column (ADR-0037): one of the space's board columns with the states it
 * groups, in workflow order, or — in a space without columns — a single state. A column with no state
 * is not drawn; a state in no column stays off the board, as Jira's BACKLOG.
 */
export type BoardColumn = { key: string; name: string; states: readonly State[] }

export const columnsOf = (workflow: Workflow): BoardColumn[] => {
  if (workflow.columns.length === 0) {
    return workflow.states.map((state) => ({ key: state.id, name: state.name, states: [state] }))
  }
  return [...workflow.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => ({
      key: column.id,
      name: column.name,
      states: workflow.states.filter((state) => state.columnId === column.id).sort((a, b) => a.position - b.position)
    }))
    .filter((column) => column.states.length > 0)
}
