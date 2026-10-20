import { describe, expect, it } from 'bun:test'

import { rankAt } from '../ranking.js'

describe('rankAt', () => {
  it('starts an empty column at 1', () => {
    expect(rankAt([], 0)).toBe(1)
  })

  it('goes above the first card and below the last', () => {
    expect(rankAt([5, 6], 0)).toBe(4)
    expect(rankAt([5, 6], 2)).toBe(7)
  })

  it('takes the midpoint between two neighbours', () => {
    expect(rankAt([1, 2, 3], 1)).toBe(1.5)
  })

  it('clamps an index past the end to the bottom', () => {
    expect(rankAt([1], 9)).toBe(2)
  })

  it('answers undefined when the neighbours are too close to split', () => {
    expect(rankAt([1, 1 + Number.EPSILON], 1)).toBeUndefined()
  })
})
