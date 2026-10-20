import { describe, expect, it } from 'vitest'

import { anchorPoint, bindingAt, followBindings, nearestAnchor } from './bindings'
import { cloneAll, parse } from './clipboard'
import { DEFAULT_STYLE, type Element, newFrame, newLinear, newShape } from './elements'
import { refit } from './frames'
import { withGroups } from './organize'
import { snapBox, toGrid } from './snapping'

const box = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height })
const rect = (x: number, y: number) => newShape('rectangle', box(x, y), DEFAULT_STYLE, 1)

describe('arrows tied to shapes', () => {
  it('ties an end to the middle of the nearest side, a little outside the outline', () => {
    const shape = rect(0, 0)
    expect(nearestAnchor(shape, { x: 98, y: 20 })).toEqual([1, 0.5])
    expect(anchorPoint(shape, [1, 0.5])).toEqual({ x: 106, y: 30 })
    expect(bindingAt([shape], { x: 110, y: 30 }, 'arrow', 1)).toEqual({ elementId: shape.id, anchor: [1, 0.5] })
    expect(bindingAt([shape], { x: 300, y: 30 }, 'arrow', 1)).toBeNull()
  })

  it('turns the anchor with the shape', () => {
    const turned = { ...rect(0, 0), angle: Math.PI }
    const point = anchorPoint(turned, [1, 0.5])
    expect(point.x).toBeCloseTo(-6)
    expect(point.y).toBeCloseTo(30)
  })

  it('redraws an arrow between the anchors of the shapes it is tied to', () => {
    const [a, b] = [rect(0, 0), rect(300, 200)]
    const arrow = {
      ...newLinear('arrow', { x: 0, y: 0 }, DEFAULT_STYLE, 2),
      startBinding: { elementId: a.id, anchor: [1, 0.5] as [number, number] },
      endBinding: { elementId: b.id, anchor: [0, 0.5] as [number, number] }
    }
    const byId = new Map<string, Element>([
      [a.id, a],
      [b.id, b]
    ])
    const drawn = followBindings(arrow, (id) => byId.get(id))
    expect(drawn.x).toBe(106)
    expect(drawn.points.at(-1)).toEqual([294 - 106, 230 - 30])
  })
})

describe('snapping', () => {
  it('rounds to the grid', () => {
    expect(toGrid(29, true)).toBe(20)
    expect(toGrid(29, false)).toBe(29)
  })

  it('catches the top of another element and draws the guide', () => {
    const other = rect(300, 100)
    const snap = snapBox(box(0, 103), [other], 1, false)
    expect(snap.dy).toBe(-3)
    expect(snap.guides[0]).toMatchObject({ y1: 100, y2: 100 })
    expect(snapBox(box(0, 140, 10, 10), [other], 1, false).dx).toBe(0)
  })
})

describe('frames and groups', () => {
  it('puts an element in the frame that holds it whole, and takes it out when it leaves', () => {
    const frame = newFrame(box(0, 0, 400, 300), 0)
    const inside = rect(20, 20)
    const outside = { ...rect(380, 20), frameId: frame.id }
    const changed = refit([inside, outside], [frame, inside, outside])
    expect(changed).toEqual([
      { ...inside, frameId: frame.id },
      { ...outside, frameId: null }
    ])
  })

  it('selects the whole outermost group of what was clicked', () => {
    const [a, b, c] = [{ ...rect(0, 0), groupIds: ['g'] }, { ...rect(200, 0), groupIds: ['g'] }, rect(400, 0)]
    expect(withGroups([a, b, c], [a.id])).toEqual([a.id, b.id])
  })
})

describe('copies', () => {
  it('gives new ids and keeps the ties inside the copied set, dropping those that leave it', () => {
    const [a, b] = [rect(0, 0), rect(300, 0)]
    const arrow = {
      ...newLinear('arrow', { x: 0, y: 0 }, DEFAULT_STYLE, 2),
      startBinding: { elementId: a.id, anchor: [1, 0.5] as [number, number] },
      endBinding: { elementId: b.id, anchor: [0, 0.5] as [number, number] }
    }
    const copies = cloneAll([a, arrow], { x: 10, y: 10 }, 5)
    const [copyA, copyArrow] = copies
    expect(copyA?.id).not.toBe(a.id)
    expect(copyArrow).toMatchObject({ startBinding: { elementId: copyA?.id }, endBinding: null })
  })

  it('reads only its own clipboard format', () => {
    expect(parse('texto qualquer')).toEqual([])
    expect(
      parse(JSON.stringify({ type: 'jiraia/whiteboard', elements: [rect(0, 0), { type: 'script' }] }))
    ).toHaveLength(1)
  })
})
