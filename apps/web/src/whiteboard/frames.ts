import { type Element, type FrameElement, isText } from './elements'
import { boundsOf, contains } from './geometry'

/**
 * Frames (Etapa 4d-b, ADR-0017): a named area that holds what is put inside it. An element is in the
 * front-most frame whose box holds it whole; moving a frame moves what it holds, and what sticks out of
 * a frame is cut at its edge.
 */
export const isFrame = (element: Element): element is FrameElement => element.type === 'frame'

/** The frame an element belongs in now, by where it is; a text inside a shape goes with its shape. */
export const frameFor = (element: Element, frames: readonly FrameElement[]): string | null => {
  if (isFrame(element)) {
    return null
  }
  const box = boundsOf(element)
  const holder = [...frames].reverse().find((frame) => contains(boundsOf(frame), box))
  return holder?.id ?? null
}

/** What each frame holds, so a moved frame takes it along. */
export const contentsOf = (frameIds: ReadonlySet<string>, elements: readonly Element[]): Element[] =>
  elements.filter(
    (element) => element.frameId !== null && frameIds.has(element.frameId) && !(isText(element) && element.containerId)
  )

/** Elements put in their frames: those whose frame changed, with the texts inside them following. */
export const refit = (moved: readonly Element[], all: readonly Element[]): Element[] => {
  const frames = all.filter(isFrame)
  const changed = moved
    .filter((element) => !(isText(element) && element.containerId))
    .flatMap((element) => {
      const frameId = frameFor(element, frames)
      return frameId === element.frameId ? [] : [{ ...element, frameId }]
    })
  const byId = new Map(all.map((element) => [element.id, element]))
  const texts = changed.flatMap((element) =>
    element.boundElements.flatMap((bound) => {
      const text = byId.get(bound.id)
      return text && isText(text) && text.frameId !== element.frameId ? [{ ...text, frameId: element.frameId }] : []
    })
  )
  return [...changed, ...texts]
}
