import { describe, expect, it } from 'vitest'

import { SQUAD_TONES, squadTone } from './squad'

describe('squad tones', () => {
  it('gives an id the same tone every time, within the palette', () => {
    const id = '0b6f1c2e-1111-4222-8333-444455556666'
    expect(squadTone(id)).toBe(squadTone(id))
    expect(squadTone(id)).toBeGreaterThanOrEqual(1)
    expect(squadTone(id)).toBeLessThanOrEqual(SQUAD_TONES)
  })

  it('spreads different ids over more than one tone', () => {
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'].map(
      (tail) => `00000000-0000-4000-8000-0000000000${tail}`
    )
    expect(new Set(ids.map(squadTone)).size).toBeGreaterThan(1)
  })
})
