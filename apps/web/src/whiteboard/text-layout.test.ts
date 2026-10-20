import { describe, expect, it } from 'vitest'

import { DEFAULT_STYLE, DEFAULT_TEXT, newLinear, newShape, newText } from './elements'
import { layoutText, wrap } from './text-layout'

describe('text layout', () => {
  it('breaks at the width, at typed breaks, and inside a word too long for the line', () => {
    expect(wrap('a b c', 40, 20, 'mono')).toEqual(['a b', 'c'])
    expect(wrap('linha\nnova', null, 20, 'mono')).toEqual(['linha', 'nova'])
    expect(wrap('abcdefgh', 40, 20, 'mono').length).toBeGreaterThan(1)
  })

  it('puts the text of a shape inside it, centred, and turns it with the shape', () => {
    const shape = { ...newShape('rectangle', { x: 0, y: 0, width: 200, height: 100 }, DEFAULT_STYLE, 1), angle: 0.5 }
    const text = { ...newText(shape, DEFAULT_STYLE, DEFAULT_TEXT, 2, shape.id), text: 'Pedido' }
    const placed = layoutText(text, shape)
    expect(placed.angle).toBe(0.5)
    expect(placed.x).toBeGreaterThanOrEqual(0)
    expect(placed.y + placed.height / 2).toBeCloseTo(50, 0)
  })

  it('centres the label of an arrow on it', () => {
    const arrow = {
      ...newLinear('arrow', { x: 0, y: 0 }, DEFAULT_STYLE, 1),
      points: [
        [0, 0],
        [200, 0]
      ] as [number, number][]
    }
    const label = layoutText({ ...newText(arrow, DEFAULT_STYLE, DEFAULT_TEXT, 2, arrow.id), text: 'sim' }, arrow)
    expect(label.x + label.width / 2).toBeCloseTo(100)
  })
})
