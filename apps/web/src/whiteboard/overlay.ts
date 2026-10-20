import { type Html, html } from '@/lib/html'

import type { Element, LinearElement } from './elements'
import { type Box, commonBounds, type Handle } from './geometry'
import { placement } from './render'

/**
 * What is drawn over the scene and never saved (ADR-0017): the selection with its handles, the area
 * being selected, and the others' pointers. Sizes are divided by the zoom, so a handle stays the same
 * size on screen whatever the zoom.
 */
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const handleAt = (handle: Handle, box: { width: number; height: number }): { x: number; y: number } => ({
  x: handle.includes('w') ? 0 : handle.includes('e') ? box.width : box.width / 2,
  y: handle.includes('n') ? 0 : handle.includes('s') ? box.height : box.height / 2
})

/** The box with its handles, in the box's own coordinates; `transform` places it on the board. */
const frameWithHandles = (box: Box & { angle?: number }, transform: string, zoom: number, editable: boolean): Html => {
  const size = 9 / zoom
  const pad = 4 / zoom
  const handles = HANDLES.map((handle) => {
    const at = handleAt(handle, box)
    return html`<rect class="wb-handle wb-handle-${handle}" data-handle="${handle}" x="${at.x - size / 2}" y="${at.y - size / 2}" width="${size}" height="${size}" rx="${2 / zoom}"></rect>`
  })
  return html`<g transform="${transform}">
    <rect class="wb-selection" x="${-pad}" y="${-pad}" width="${box.width + 2 * pad}" height="${box.height + 2 * pad}"></rect>
    ${
      editable
        ? html`${handles}<line class="wb-rotate-stem" x1="${box.width / 2}" y1="${-pad}" x2="${box.width / 2}" y2="${-22 / zoom}"></line>
      <circle class="wb-handle wb-rotate" data-rotate="" cx="${box.width / 2}" cy="${-26 / zoom}" r="${5 / zoom}"></circle>`
        : ''
    }
  </g>`
}

/** One element selected: its own turned box. Several: a thin box each, and handles on the whole. */
export const selectionMarkup = (selected: readonly Element[], zoom: number, editable: boolean): Html => {
  const [only] = selected
  if (!only) {
    return html``
  }
  const movable = editable && selected.every((element) => !element.locked)
  if (selected.length === 1) {
    return frameWithHandles(only, placement(only), zoom, movable)
  }
  const outlines = selected.map(
    (element) =>
      html`<rect class="wb-selection wb-selection-member" transform="${placement(element)}" width="${element.width}" height="${element.height}"></rect>`
  )
  const box = commonBounds(selected)
  return html`${outlines}${frameWithHandles(box, `translate(${box.x} ${box.y})`, zoom, movable)}`
}

export const marqueeMarkup = (box: Box | undefined): Html =>
  box
    ? html`<rect class="wb-marquee" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"></rect>`
    : html``

/** The others' pointers, with their names, in their caret colours. */
export const cursorsMarkup = (
  others: readonly { x: number; y: number; name: string; color: string }[],
  zoom: number
): Html =>
  html`${others.map(
    (
      other
    ) => html`<g class="wb-cursor" transform="translate(${other.x} ${other.y}) scale(${1 / zoom})"><path d="M0 0 L0 16 L4 12 L8 20 L11 19 L7 11 L13 11 z" fill="${other.color}"></path>
      <text x="14" y="24" fill="${other.color}">${other.name}</text></g>`
  )}`

/** A line selected alone: a dot on each point to drag, and a smaller one between two to add a point. */
export const pointsMarkup = (line: LinearElement, zoom: number): Html => {
  const points = line.points.map(([px, py]) => ({ x: line.x + px, y: line.y + py }))
  const middles = points.slice(1).map((point, index) => {
    const before = points[index] as { x: number; y: number }
    return { x: (before.x + point.x) / 2, y: (before.y + point.y) / 2 }
  })
  return html`${middles.map(
    (middle, index) =>
      html`<circle class="wb-midpoint" data-midpoint="${index}" cx="${middle.x}" cy="${middle.y}" r="${4 / zoom}"></circle>`
  )}${points.map((point, index) => html`<circle class="wb-point" data-point="${index}" cx="${point.x}" cy="${point.y}" r="${6 / zoom}"></circle>`)}`
}

/** The shape an arrow's end is over: it would tie there. */
export const hoverMarkup = (box: Box): Html =>
  html`<rect class="wb-hover" x="${box.x - 4}" y="${box.y - 4}" width="${box.width + 8}" height="${box.height + 8}" rx="6"></rect>`

export const guidesMarkup = (guides: readonly { x1: number; y1: number; x2: number; y2: number }[]): Html =>
  html`${guides.map((guide) => html`<line class="wb-guide" x1="${guide.x1}" y1="${guide.y1}" x2="${guide.x2}" y2="${guide.y2}"></line>`)}`
