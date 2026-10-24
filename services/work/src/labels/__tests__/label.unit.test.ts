import { describe, expect, it } from 'bun:test'

import { colorOf } from '../label.schemas.js'

describe('colorOf', () => {
  it('gives a name always the same colour, never grey', () => {
    expect(colorOf('okr-saude-escala')).toBe(colorOf('okr-saude-escala'))
    const colors = ['a', 'b', 'c', 'financeiro', 'business-form', 'cs prioritário'].map(colorOf)
    expect(colors).not.toContain('gray')
    expect(new Set(colors).size).toBeGreaterThan(1)
  })

  it("takes the colour from the first hex digits of the name's md5", () => {
    // md5('financeiro') starts 7348cba; 0x7348cba % 8 = 2. The database repeats this in labelColorSql.
    expect(colorOf('financeiro')).toBe('yellow')
  })
})
