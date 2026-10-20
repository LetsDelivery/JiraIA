import { describe, expect, it } from 'vitest'

import { type LaneCard, lanesOf } from './lanes'

const card = (key: string, extra: Partial<LaneCard> = {}): LaneCard => ({
  id: key,
  key,
  title: key,
  assignee: null,
  priority: 'medium',
  typeId: 't1',
  parentId: null,
  ...extra
})

const names = { types: [{ id: 't1', name: 'História' }], cards: [] }

describe('lanesOf', () => {
  it('keeps every card in one lane without grouping', () => {
    expect(lanesOf([card('A'), card('B')], 'none', names)).toHaveLength(1)
  })

  it('groups by assignee, by name, with nobody last', () => {
    const ana = { id: 'ana', name: 'Ana' }
    const bia = { id: 'bia', name: 'Bia' }
    const lanes = lanesOf([card('A'), card('B', { assignee: bia }), card('C', { assignee: ana })], 'assignee', names)

    expect(lanes.map((lane) => [lane.label, lane.cards.map((each) => each.key)])).toEqual([
      ['Ana', ['C']],
      ['Bia', ['B']],
      ['Sem responsável', ['A']]
    ])
  })

  it('orders priority lanes highest first', () => {
    const lanes = lanesOf([card('A', { priority: 'low' }), card('B', { priority: 'highest' })], 'priority', names)
    expect(lanes.map((lane) => lane.label)).toEqual(['Altíssima', 'Baixa'])
  })
})
