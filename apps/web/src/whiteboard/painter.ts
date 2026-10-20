import { html } from '@/lib/html'

import { type Element, isLinear } from './elements'
import { isFrame } from './frames'
import { boundsOf, type Vec } from './geometry'
import { cursorsMarkup, guidesMarkup, hoverMarkup, marqueeMarkup, pointsMarkup, selectionMarkup } from './overlay'
import { elementMarkup } from './render'
import { areaBetween, type Whiteboard } from './whiteboard'

/**
 * Drawing a whiteboard (ADR-0017): the scene — background, optional grid, elements back to front, each
 * cut at the edge of its frame — and over it what is never saved: the selection, the area being
 * selected, the alignment guides, the shape an arrow would tie to, and the others' pointers.
 */
const clipId = (frameId: string) => `wb-clip-${frameId}`

/** Elements back to front, each inside its frame's clip; those being erased drawn faint. */
export const elementsMarkup = (elements: readonly Element[], erasing: ReadonlySet<string> = new Set()) => {
  const frames = new Set(elements.filter(isFrame).map((frame) => frame.id))
  return elements.map((element) => {
    const drawn = erasing.has(element.id)
      ? html`<g class="is-erasing">${elementMarkup(element)}</g>`
      : elementMarkup(element)
    return element.frameId && frames.has(element.frameId)
      ? html`<g clip-path="url(#${clipId(element.frameId)})">${drawn}</g>`
      : drawn
  })
}

export const clipsMarkup = (elements: readonly Element[]) =>
  elements
    .filter(isFrame)
    .map(
      (frame) =>
        html`<clipPath id="${clipId(frame.id)}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="8"></rect></clipPath>`
    )

const others = (board: Whiteboard) =>
  [...board.awareness.getStates().entries()].flatMap(([id, state]) => {
    const pointer = state.pointer as Vec | null | undefined
    const user = state.user as { name: string; color: string } | undefined
    return id !== board.awareness.clientID && pointer && user
      ? [{ ...pointer, name: String(user.name), color: String(user.color) }]
      : []
  })

/** The selection: a line's points when one line is selected, its box and handles otherwise. */
const selectionOf = (board: Whiteboard) => {
  if (board.editing) {
    return html``
  }
  const selected = board.selected()
  const [only] = selected
  if (selected.length === 1 && only && isLinear(only) && board.editable && !only.locked) {
    return pointsMarkup(only, board.zoom)
  }
  return selectionMarkup(selected, board.zoom, board.editable)
}

const overlayMarkup = (board: Whiteboard) => {
  const marquee = board.gesture?.kind === 'marquee' ? areaBetween(board.gesture.from, board.gesture.to) : undefined
  const hover = board.hover ? board.scene.get(board.hover) : undefined
  return html`${hover ? hoverMarkup(boundsOf(hover)) : ''}${selectionOf(board)}${marqueeMarkup(marquee)}${guidesMarkup(board.guides)}${cursorsMarkup(others(board), board.zoom)}`
}

export const paint = (board: Whiteboard): void => {
  const svg = board.svg
  const transform = `translate(${board.view.x} ${board.view.y}) scale(${board.zoom})`
  const elements = board.scene
    .all()
    .filter((element) => element.id !== board.editing)
    .map((element) =>
      element.type === 'image' ? { ...element, url: board.images.get(element.fileId) ?? element.url } : element
    )
  svg.querySelector('.wb-scene')?.setAttribute('transform', transform)
  svg.querySelector('.wb-background')?.setAttribute('fill', board.scene.settings.background)
  svg.querySelector('.wb-grid')?.setAttribute('visibility', board.grid ? 'visible' : 'hidden')
  const clips = svg.querySelector('.wb-clips')
  const layer = svg.querySelector('.wb-elements')
  const overlay = svg.querySelector('.wb-overlay')
  if (clips && layer && overlay) {
    clips.innerHTML = html`${clipsMarkup(elements)}`.value
    const erasing = board.gesture?.kind === 'erase' ? board.gesture.ids : new Set<string>()
    layer.innerHTML = html`${elementsMarkup(elements, erasing)}`.value
    overlay.setAttribute('transform', transform)
    overlay.innerHTML = overlayMarkup(board).value
  }
}
