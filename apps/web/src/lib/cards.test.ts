import { describe, expect, it } from 'vitest'

import { dropIndex, initials, labelColor, parseLabels } from './cards'

describe('dropIndex', () => {
  const column = [
    { top: 0, height: 40 },
    { top: 48, height: 40 },
    { top: 96, height: 40 }
  ]

  it('drops at the top above the first card middle', () => {
    expect(dropIndex(column, 10)).toBe(0)
  })

  it('drops between cards by their middles', () => {
    expect(dropIndex(column, 60)).toBe(1)
  })

  it('drops at the bottom below the last card', () => {
    expect(dropIndex(column, 500)).toBe(3)
  })
})

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Ana Souza Lima')).toBe('AS')
  })

  it('skips words that do not start with a letter', () => {
    expect(initials('Rui (leitor)')).toBe('R')
  })
})

describe('parseLabels', () => {
  it('splits on commas, trims and drops blanks and repeats', () => {
    expect(parseLabels(' okr-saude-escala, , business-form,okr-saude-escala ')).toEqual([
      'okr-saude-escala',
      'business-form'
    ])
  })
})

describe('labelColor', () => {
  it('reads the colour from the catalogue, and grey for a name it does not know', () => {
    const labels = [{ name: 'okr', color: 'teal' }] as const
    expect(labelColor(labels, 'okr')).toBe('teal')
    expect(labelColor(labels, 'nova')).toBe('gray')
  })
})
