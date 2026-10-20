import { describe, expect, it } from 'vitest'

import { adjustableValues, adjusted, age, fieldLabel, valueText } from './proposals'

describe('valueText', () => {
  it('names ids, translates priorities and shows empty as a dash', () => {
    expect(valueText('stateId', 's1', { s1: 'Em andamento' })).toBe('Em andamento')
    expect(valueText('priority', 'highest', {})).toBe('Altíssima')
    expect(valueText('labels', ['a', 'b'], {})).toBe('a, b')
    expect(valueText('assigneeId', null, {})).toBe('—')
    expect(valueText('labels', [], {})).toBe('—')
  })

  it('reads a link from the card being changed', () => {
    expect(valueText('link', { type: 'blocks', direction: 'outward', card: 'TEC-4' }, {})).toBe('bloqueia TEC-4')
    expect(valueText('link', { type: 'blocks', direction: 'inward', card: 'TEC-4' }, {})).toBe(
      'TEC-4 bloqueia este card'
    )
  })
})

describe('fieldLabel', () => {
  it('names standard fields in pt-BR and custom ones by their name', () => {
    expect(fieldLabel('stateId', {})).toBe('Estado')
    expect(fieldLabel('field:f1', { f1: 'Impacto' })).toBe('Impacto')
  })
})

describe('adjusting', () => {
  it('offers only the text an item writes', () => {
    expect(adjustableValues({ kind: 'update_card', cardId: 'c', changes: { title: 'A', priority: 'high' } })).toEqual({
      title: 'A'
    })
    expect(adjustableValues({ kind: 'comment', cardId: 'c', body: 'Oi' })).toEqual({ body: 'Oi' })
  })

  it('puts the approver text in place, keeping the rest', () => {
    const card = { title: 'A', description: '', priority: 'high' as const, labels: [] }
    expect(adjusted({ kind: 'create_card', card }, { title: 'B' })).toEqual({
      kind: 'create_card',
      card: { ...card, title: 'B' }
    })
  })
})

describe('age', () => {
  const now = new Date('2026-10-19T12:00:00Z')

  it('says how long ago, in whole units', () => {
    expect(age('2026-10-19T11:59:30Z', now)).toBe('agora')
    expect(age('2026-10-19T11:15:00Z', now)).toBe('há 45 min')
    expect(age('2026-10-19T09:00:00Z', now)).toBe('há 3 h')
    expect(age('2026-10-16T12:00:00Z', now)).toBe('há 3 dias')
  })
})
