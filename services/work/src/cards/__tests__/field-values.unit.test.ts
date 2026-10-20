import { describe, expect, it } from 'bun:test'

import { fieldChanges } from '../card-rules.js'
import { parseFieldValue } from '../field.schemas.js'
import { mentionedIds } from '../mentions.js'

const squad = { name: 'Squad', kind: 'select' as const, options: ['Core', 'Growth'] }

describe('parseFieldValue', () => {
  it('takes a value of the field kind and clears with null', () => {
    expect(parseFieldValue({ name: 'Impacto', kind: 'number', options: [] }, 3)).toBe(3)
    expect(parseFieldValue({ name: 'Lançamento', kind: 'date', options: [] }, '2026-11-30')).toBe('2026-11-30')
    expect(parseFieldValue({ name: 'Figma', kind: 'url', options: [] }, 'https://figma.com/x')).toBe(
      'https://figma.com/x'
    )
    expect(parseFieldValue(squad, null)).toBeNull()
  })

  it('refuses a value of another kind, naming the field', () => {
    expect(() => parseFieldValue({ name: 'Impacto', kind: 'number', options: [] }, 'alto')).toThrow(/Impacto/)
    expect(() => parseFieldValue({ name: 'Figma', kind: 'url', options: [] }, 'javascript:alert(1)')).toThrow()
  })

  it('keeps a selection to its options, and a multiple one without repeats', () => {
    expect(parseFieldValue(squad, 'Core')).toBe('Core')
    expect(() => parseFieldValue(squad, 'Ops')).toThrow(/Squad/)
    expect(parseFieldValue({ ...squad, kind: 'multi_select' }, ['Core', 'Core', 'Growth'])).toEqual(['Core', 'Growth'])
    expect(() => parseFieldValue({ ...squad, kind: 'multi_select' }, ['Core', 'Ops'])).toThrow()
  })
})

describe('fieldChanges', () => {
  it('names each changed custom value as field:<id>, set and cleared alike', () => {
    expect(fieldChanges({ a: 1, b: ['x'] }, { a: 2, b: ['x'], c: 'novo' })).toEqual({
      'field:a': { before: 1, after: 2 },
      'field:c': { before: null, after: 'novo' }
    })
    expect(fieldChanges({ a: 1 }, {})).toEqual({ 'field:a': { before: 1, after: null } })
  })
})

describe('mentionedIds', () => {
  it('reads each <@id> once, lowercased, and ignores what only looks like one', () => {
    const ana = '0b6f1c2e-1111-4222-8333-444455556666'
    expect(mentionedIds(`Oi <@${ana}>, e <@${ana.toUpperCase()}> de novo; <@ana> não conta`)).toEqual([ana])
  })
})
