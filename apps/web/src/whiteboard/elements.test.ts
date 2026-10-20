import { describe, expect, it } from 'vitest'
import { arrowheadPath } from './arrowheads'
import { clean, DEFAULT_STYLE, DEFAULT_TEXT, newFreedraw, newShape, newText, normalizePoints } from './elements'
import { fromLegacy } from './legacy'
import { curvePoints, elbowPoints } from './routes'

describe('elements', () => {
  it('a text made inside a shape gets an id of its own', () => {
    const shape = newShape('rectangle', { x: 0, y: 0, width: 100, height: 60 }, DEFAULT_STYLE, 1)
    const text = newText(shape, DEFAULT_STYLE, DEFAULT_TEXT, 2, shape.id)
    expect(text.id).not.toBe(shape.id)
    expect(text).toMatchObject({ type: 'text', containerId: shape.id, autoResize: false })
  })

  it('cleans what another client wrote: colours, numbers, links and types', () => {
    const hostile = {
      id: 'a',
      type: 'rectangle',
      x: '1',
      strokeColor: '"/><script>',
      opacity: 900,
      link: 'javascript:alert(1)',
      strokeWidth: Number.NaN
    }
    expect(clean(hostile)).toMatchObject({ x: 0, strokeColor: '#1e1e1e', opacity: 100, link: null, strokeWidth: 2 })
    expect(clean({ id: 'b', type: 'script' })).toBeUndefined()
    expect(clean({ id: 'c', type: 'image', url: 'javascript:x' })).toMatchObject({ url: '' })
  })

  it('makes the points of a stroke relative to its own corner', () => {
    const stroke = {
      ...newFreedraw({ x: 10, y: 10 }, DEFAULT_STYLE, 1),
      points: [
        [-5, 0],
        [5, 20]
      ] as [number, number][]
    }
    expect(normalizePoints(stroke)).toMatchObject({
      x: 5,
      y: 10,
      width: 10,
      height: 20,
      points: [
        [0, 0],
        [10, 20]
      ]
    })
  })
})

describe('boards drawn before Etapa 4d', () => {
  it('opens a note as a filled rectangle with its text inside, frames behind', () => {
    const elements = fromLegacy([
      { id: 'n', kind: 'note', x: 0, y: 0, w: 180, h: 180, text: 'Ideia', color: 'yellow' },
      { id: 'f', kind: 'frame', x: -20, y: -20, w: 400, h: 300, text: 'Seção', color: 'gray' }
    ])
    expect(elements.map((each) => each.type)).toEqual(['frame', 'rectangle', 'text'])
    expect(elements[1]).toMatchObject({
      id: 'n',
      backgroundColor: '#ffec99',
      boundElements: [{ id: 'n-text', type: 'text' }]
    })
    expect(elements[2]).toMatchObject({ text: 'Ideia', containerId: 'n' })
    expect(elements[0]).toMatchObject({ name: 'Seção' })
  })
})

describe('paths and tips', () => {
  it('routes elbows with horizontal and vertical runs only', () => {
    expect(
      elbowPoints([
        [0, 0],
        [100, 40]
      ])
    ).toEqual([
      [0, 0],
      [50, 0],
      [50, 40],
      [100, 40]
    ])
  })

  it('bends a two-point curve through a third point', () => {
    expect(
      curvePoints([
        [0, 0],
        [100, 0]
      ])
    ).toHaveLength(3)
  })

  it('draws a filled triangle and a crow foot', () => {
    expect(arrowheadPath('triangle', { x: 10, y: 0 }, { x: 0, y: 0 }, 2).filled).toBe(true)
    expect(arrowheadPath('many', { x: 10, y: 0 }, { x: 0, y: 0 }, 2).d.match(/M/g)).toHaveLength(3)
  })
})
