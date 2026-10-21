import { describe, expect, it } from 'vitest'

import { DEFAULT_STYLE, newShape } from './elements'
import { clampZoom, fitView, MAX_ZOOM, MIN_ZOOM, previewMarkup, previewOf, viewBoxOf, zoomAt } from './preview'

describe('board preview', () => {
  it('reads a stored board: its elements, the box around them and its background', () => {
    const shape = newShape('rectangle', { x: 10, y: 20, width: 100, height: 50 }, DEFAULT_STYLE, 1)
    const preview = previewOf({ elements: [shape, { id: 'x', type: 'script' }], board: { background: '#121212' } })
    expect(preview.elements.map((each) => each.id)).toEqual([shape.id])
    expect(preview.bounds).toMatchObject({ x: 10, y: 20, width: 100, height: 50 })
    expect(preview.background).toBe('#121212')
  })

  it('reads an empty board without failing', () => {
    expect(previewOf({}).elements).toEqual([])
  })

  it('fits a wide board in the stage, centred, and never enlarges a small one', () => {
    const wide = fitView({ x: 0, y: 0, width: 2000, height: 400 }, { width: 512, height: 360 })
    expect(wide).toEqual({ x: 1000, y: 200, zoom: 0.25 })
    expect(fitView({ x: 0, y: 0, width: 50, height: 50 }, { width: 800, height: 400 }).zoom).toBe(1)
  })

  it('keeps the zoom between its limits', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
  })

  it('turns a view into the viewBox centred on it', () => {
    expect(viewBoxOf({ x: 100, y: 50, zoom: 2 }, { width: 400, height: 200 })).toBe('0 0 200 100')
  })

  it('zooms around the pointer, keeping the board point under it in place', () => {
    const size = { width: 400, height: 200 }
    const next = zoomAt({ x: 0, y: 0, zoom: 1 }, size, { x: 300, y: 100 }, 2)
    expect(next).toEqual({ x: 50, y: 0, zoom: 2 })
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, size, { x: 200, y: 100 }, 99).zoom).toBe(MAX_ZOOM)
  })

  it('draws the elements as SVG markup', () => {
    const shape = newShape('ellipse', { x: 0, y: 0, width: 10, height: 10 }, DEFAULT_STYLE, 1)
    const markup = previewMarkup([shape]).value
    expect(markup).toContain(`data-element="${shape.id}"`)
    expect(markup).toContain('class="wb-scene"')
  })
})
