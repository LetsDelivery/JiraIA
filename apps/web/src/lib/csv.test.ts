import { describe, expect, it } from 'vitest'

import { parseCsv, toCsv } from './csv'

describe('toCsv', () => {
  it('quotes what needs quoting, and only that', () => {
    expect(
      toCsv([
        ['nome', 'motivo'],
        ['Ana', 'disse "sim", depois']
      ])
    ).toBe('nome,motivo\r\nAna,"disse ""sim"", depois"')
  })
})

describe('parseCsv', () => {
  it('reads commas or semicolons, quoted cells and blank lines', () => {
    expect(parseCsv('email;sistema\n"ana@uselets.com";"AWS; prod"\n\n')).toEqual([
      ['email', 'sistema'],
      ['ana@uselets.com', 'AWS; prod']
    ])
    expect(parseCsv('a,b\r\nx,"y ""z"""')).toEqual([
      ['a', 'b'],
      ['x', 'y "z"']
    ])
  })

  it('reads back what toCsv wrote', () => {
    const rows = [
      ['a', 'b, c'],
      ['"d"', 'e']
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})
