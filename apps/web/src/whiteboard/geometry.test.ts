import { describe, expect, it } from 'vitest'

import { DEFAULT_STYLE, newLinear, newShape } from './elements'
import { angleTo, boundsOf, commonBounds, fitInto, hits, resizeBox, rotate } from './geometry'

const box = { x: 0, y: 0, width: 100, height: 50 }
const near = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 5)

describe('geometry', () => {
  it('turns a point around another', () => {
    const turned = rotate({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2)
    near(turned.x, 0)
    near(turned.y, 10)
  })

  it('bounds a turned element by its turned corners', () => {
    const shape = { ...newShape('rectangle', box, DEFAULT_STYLE, 1), angle: Math.PI / 2 }
    const bounds = boundsOf(shape)
    near(bounds.width, 50)
    near(bounds.height, 100)
    near(bounds.x, 25)
    expect(commonBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('hits a shape inside, a line near it, and a frame only on its edge', () => {
    const ellipse = newShape('ellipse', box, DEFAULT_STYLE, 1)
    expect(hits(ellipse, { x: 50, y: 25 }, 0)).toBe(true)
    expect(hits(ellipse, { x: 2, y: 2 }, 0)).toBe(false)
    const line = {
      ...newLinear('line', { x: 0, y: 0 }, DEFAULT_STYLE, 1),
      points: [
        [0, 0],
        [100, 0]
      ] as [number, number][]
    }
    expect(hits(line, { x: 50, y: 3 }, 2)).toBe(true)
    expect(hits(line, { x: 50, y: 20 }, 2)).toBe(false)
    const frame = {
      ...newShape('rectangle', { x: 0, y: 0, width: 400, height: 300 }, DEFAULT_STYLE, 1),
      type: 'frame' as const,
      name: 'F'
    }
    expect(hits(frame as never, { x: 200, y: 150 }, 4)).toBe(false)
    expect(hits(frame as never, { x: 1, y: 150 }, 4)).toBe(true)
  })

  it('resizes from a corner with the opposite corner fixed, and keeps the ratio with Shift', () => {
    expect(resizeBox(box, 0, 'se', { x: 20, y: 10 }, false)).toEqual({ x: 0, y: 0, width: 120, height: 60 })
    expect(resizeBox(box, 0, 'nw', { x: -20, y: 0 }, false)).toEqual({ x: -20, y: 0, width: 120, height: 50 })
    const kept = resizeBox(box, 0, 'se', { x: 100, y: 0 }, true)
    expect(kept.width / kept.height).toBeCloseTo(2)
  })

  it('keeps the fixed side in place on the board when the element is turned', () => {
    const resized = resizeBox(box, Math.PI, 'e', { x: -30, y: 0 }, false)
    near(resized.width, 130)
    // Turned half a circle, the east handle is on the left of the board: the right side stays put.
    const fixed = rotate({ x: resized.x, y: 25 }, { x: resized.x + 65, y: 25 }, Math.PI)
    near(fixed.x, 100)
  })

  it('snaps a rotation to 15° steps with Shift', () => {
    const angle = angleTo({ x: 0, y: 0 }, { x: 10, y: -9 }, true)
    expect(Math.round((angle * 180) / Math.PI) % 15).toBe(0)
  })

  it('fits a group into a new box, scaling points and, for a group, the font', () => {
    const line = {
      ...newLinear('line', { x: 0, y: 0 }, DEFAULT_STYLE, 1),
      width: 100,
      height: 0,
      points: [
        [0, 0],
        [100, 0]
      ] as [number, number][]
    }
    const fitted = fitInto(line, box, { x: 0, y: 0, width: 200, height: 100 }, true)
    expect(fitted.points).toEqual([
      [0, 0],
      [200, 0]
    ])
  })
})
