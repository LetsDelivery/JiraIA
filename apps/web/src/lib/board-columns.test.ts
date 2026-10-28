import { describe, expect, it } from 'vitest'

import type { Workflow } from '@/api/requests'

import { columnsOf } from './board-columns'

/** The board's columns (ADR-0037): Jira's grouping of states, and the states it keeps off the board. */
const state = (id: string, position: number, columnId: string | null) =>
  ({ id, name: id, group: 'in_progress', position, columnId }) as const

describe('the board columns', () => {
  it('are one per state in a space without columns', () => {
    const workflow = { states: [state('A', 0, null), state('B', 1, null)], types: [], columns: [] } as Workflow

    expect(columnsOf(workflow).map((column) => [column.name, column.states.map((each) => each.id)])).toEqual([
      ['A', ['A']],
      ['B', ['B']]
    ])
  })

  it('group the states of a column in workflow order, leave out states in none, and skip an empty column', () => {
    const workflow = {
      states: [
        state('REVISAR', 3, 'c2'),
        state('BACKLOG', 0, null),
        state('EM PROGRESSO', 2, 'c2'),
        state('NÃO INICIADO', 1, 'c1')
      ],
      types: [],
      columns: [
        { id: 'c2', name: 'EM PROGRESSO', position: 1 },
        { id: 'c1', name: 'NÃO INICIADO', position: 0 },
        { id: 'c3', name: 'VAZIA', position: 2 }
      ]
    } as Workflow

    expect(columnsOf(workflow).map((column) => [column.name, column.states.map((each) => each.id)])).toEqual([
      ['NÃO INICIADO', ['NÃO INICIADO']],
      ['EM PROGRESSO', ['EM PROGRESSO', 'REVISAR']]
    ])
  })
})
