import { describe, expect, it } from 'vitest'

import { spacePath, suggestKey } from './space-types'

describe('suggestKey', () => {
  it('takes the initials of a name with several words', () => {
    expect(suggestKey('Requisições para Produto')).toBe('RPP')
  })

  it('takes the start of a single word, without accents', () => {
    expect(suggestKey('Jurídico')).toBe('JUR')
  })

  it('never starts with a digit, which a key may not', () => {
    expect(suggestKey('2026 Planejamento')).toBe('P')
  })
})

describe('spacePath', () => {
  it('addresses a space by its key', () => {
    expect(spacePath('REQ')).toBe('/espacos/REQ')
  })
})
