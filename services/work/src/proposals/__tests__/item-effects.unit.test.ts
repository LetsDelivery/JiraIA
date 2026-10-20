import { describe, expect, it } from 'bun:test'

import type { CardRow } from '../../cards/schemas.js'
import {
  currentValues,
  drifted,
  intendedValues,
  itemCardId,
  itemChanges,
  sameValue,
  toUpdate
} from '../item-effects.js'

const card = {
  title: 'Contrato',
  labels: ['juridico'],
  assigneeId: null,
  customFields: { f1: 3 }
} as unknown as CardRow

describe('field values', () => {
  it('name custom fields as the history does, and clear with null', () => {
    expect(intendedValues({ title: 'B', customFields: { f1: 4, f2: null } })).toEqual({
      title: 'B',
      'field:f1': 4,
      'field:f2': null
    })
  })

  it('read the card values of the touched fields only, missing ones as null', () => {
    expect(currentValues(card, { title: 'B', assigneeId: 'x', customFields: { f1: 4, f2: 1 } })).toEqual({
      title: 'Contrato',
      assigneeId: null,
      'field:f1': 3,
      'field:f2': null
    })
  })

  it('go back into a change a card accepts', () => {
    expect(toUpdate({ title: 'A', 'field:f1': 3 })).toEqual({ title: 'A', customFields: { f1: 3 } })
    expect(toUpdate({ labels: [] })).toEqual({ labels: [] })
  })
})

describe('drifted', () => {
  it('compares by content, a missing value as null', () => {
    expect(sameValue(['a'], ['a'])).toBe(true)
    expect(sameValue(undefined, null)).toBe(true)
    expect(drifted({ title: 'A', labels: ['a'] }, { title: 'B', labels: ['a'] })).toEqual({
      title: { before: 'A', after: 'B' }
    })
  })
})

describe('itemChanges', () => {
  it('shows a new card by its filled fields', () => {
    const changes = itemChanges(
      { kind: 'create_card', card: { title: 'Novo', description: '', priority: 'high', labels: [] } },
      {}
    )
    expect(changes).toEqual({ title: { before: null, after: 'Novo' }, priority: { before: null, after: 'high' } })
  })

  it('shows a field change from its base, leaving out what would not change', () => {
    const input = { kind: 'update_card' as const, cardId: 'c', changes: { title: 'B', priority: 'low' as const } }
    expect(itemChanges(input, { title: 'A', priority: 'low' })).toEqual({ title: { before: 'A', after: 'B' } })
    expect(itemCardId(input)).toBe('c')
  })

  it('shows a comment and a link as what they add', () => {
    expect(itemChanges({ kind: 'comment', cardId: 'c', body: 'Oi' }, {})).toEqual({
      body: { before: null, after: 'Oi' }
    })
    expect(
      itemChanges({ kind: 'link', cardId: 'c', link: { type: 'blocks', direction: 'outward', key: 'TEC-4' } }, {})
    ).toEqual({ link: { before: null, after: { type: 'blocks', direction: 'outward', card: 'TEC-4' } } })
    expect(
      itemCardId({ kind: 'create_card', card: { title: 'x', description: '', priority: 'medium', labels: [] } })
    ).toBeNull()
  })
})
