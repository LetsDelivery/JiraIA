import * as Y from 'yjs'

import { html } from '@/lib/html'

import type { Element } from './elements'
import { type Box, commonBounds } from './geometry'
import { clipsMarkup, elementsMarkup } from './painter'
import { Scene } from './scene'

/**
 * A board seen from a page (escopo-mvp 5.2): its stored JSON drawn read-only, framed so the whole board
 * fits, zoomed and moved without touching the board itself.
 */
export type Preview = { elements: Element[]; bounds: Box; background: string }
export type View = { x: number; y: number; zoom: number }
export type Size = { width: number; height: number }

const MARGIN = 24
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

/** The board as it was last stored: its elements back to front, the box around them, its background. */
export const previewOf = (json: Record<string, unknown>): Preview => {
  const scene = new Scene(new Y.Doc())
  scene.load(json)
  const elements = scene.all()
  return { elements, bounds: commonBounds(elements), background: scene.settings.background }
}

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** The view that shows the whole board centred in `size`, never enlarged past its real size. */
export const fitView = (bounds: Box, size: Size): View => {
  const across = Math.max(1, bounds.width + 2 * MARGIN)
  const down = Math.max(1, bounds.height + 2 * MARGIN)
  const zoom = clampZoom(Math.min(1, size.width / across, size.height / down))
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom }
}

/** The SVG viewBox for a view: `x`, `y` is the board point at the centre of the stage. */
export const viewBoxOf = (view: View, size: Size): string => {
  const width = size.width / view.zoom
  const height = size.height / view.zoom
  return `${view.x - width / 2} ${view.y - height / 2} ${width} ${height}`
}

/** The view zoomed to `zoom` around `point` (pixels from the stage's corner), which stays under it. */
export const zoomAt = (view: View, size: Size, point: { x: number; y: number }, zoom: number): View => {
  const next = clampZoom(zoom)
  const dx = point.x - size.width / 2
  const dy = point.y - size.height / 2
  const under = { x: view.x + dx / view.zoom, y: view.y + dy / view.zoom }
  return { x: under.x - dx / next, y: under.y - dy / next, zoom: next }
}

/** The stage's markup: frame clips, then every element, in the scene the dark theme inverts. */
export const previewMarkup = (elements: readonly Element[]) =>
  html`<defs>${clipsMarkup(elements)}</defs><g class="wb-scene">${elementsMarkup(elements)}</g>`
