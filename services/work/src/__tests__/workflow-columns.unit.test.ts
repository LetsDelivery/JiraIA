import { describe, expect, it } from 'bun:test'

import { columnOrder } from '../cards/workflow.service.js'

/** A migrated board's columns after the space's states are reordered in settings (ADR-0037). */
const columns = [{ id: 'doing' }, { id: 'todo' }, { id: 'empty' }, { id: 'done' }]
const states = [
  { id: 'a-fazer', columnId: 'todo' },
  { id: 'em-progresso', columnId: 'doing' },
  { id: 'revisar', columnId: 'doing' },
  { id: 'concluido', columnId: 'done' },
  { id: 'backlog', columnId: null }
]

describe('a board column after its states are reordered', () => {
  it('sits where its first state now is, and an empty one goes last', () => {
    const order = ['backlog', 'concluido', 'revisar', 'a-fazer', 'em-progresso']

    expect(columnOrder(columns, states, order)).toEqual(['done', 'doing', 'todo', 'empty'])
  })

  it('keeps the board as it was when the states keep their order', () => {
    const order = ['em-progresso', 'revisar', 'a-fazer', 'concluido', 'backlog']

    expect(columnOrder(columns, states, order)).toEqual(['doing', 'todo', 'done', 'empty'])
  })
})
