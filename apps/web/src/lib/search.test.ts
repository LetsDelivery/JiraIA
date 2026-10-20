import { describe, expect, it } from 'vitest'

import { cardKey, cardKeyIn, spaceKeyOf } from './search'

describe('the search box', () => {
  it('reads a key, in any case and with spaces around it', () => {
    expect(cardKey(' prd-219 ')).toBe('PRD-219')
    expect(cardKey('REQ-1')).toBe('REQ-1')
  })

  it('takes anything else as text', () => {
    expect(cardKey('rastreio')).toBeUndefined()
    expect(cardKey('PRD 219')).toBeUndefined()
    expect(cardKey('1-2')).toBeUndefined()
  })

  it('reads the card of a pasted address, and nothing from other text', () => {
    expect(cardKeyIn('http://localhost:5280/espacos/PRD?card=prd-219')).toBe('PRD-219')
    expect(cardKeyIn(' TEC-12 ')).toBe('TEC-12')
    expect(cardKeyIn('https://example.test/espacos/PRD')).toBeUndefined()
    expect(cardKeyIn('travar pedidos')).toBeUndefined()
  })

  it('names the space of a key', () => {
    expect(spaceKeyOf('PRD-219')).toBe('PRD')
  })
})
