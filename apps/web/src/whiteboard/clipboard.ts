import {
  type Binding,
  clean,
  DEFAULT_STYLE,
  DEFAULT_TEXT,
  type Element,
  isLinear,
  isText,
  newSeed,
  newText
} from './elements'
import { commonBounds, type Vec } from './geometry'
import type { Whiteboard } from './whiteboard'

/**
 * Copying elements (Etapa 4d-b, ADR-0017): within a board, between boards, and through the system
 * clipboard as JSON text. A copy gets new ids, and every link inside the copied set — a text in its
 * shape, an arrow tied to a shape, a group, a frame — points at the copies; a link to something left out
 * is dropped.
 */
const MARK = 'jiraia/whiteboard'

/** The selection with the texts inside it, as the clipboard should carry it. */
export const withTexts = (board: Whiteboard, elements: readonly Element[]): Element[] => {
  const ids = new Set(elements.map((element) => element.id))
  const texts = elements.flatMap((element) =>
    element.boundElements.flatMap((bound) => {
      const text = board.scene.get(bound.id)
      return text && isText(text) && !ids.has(text.id) ? [text] : []
    })
  )
  return [...elements, ...texts]
}

const remap = (ids: Map<string, string>, id: string | null | undefined): string | null =>
  id ? (ids.get(id) ?? null) : null

/** A tie to a copied element follows the copy; a tie to one left behind is dropped. */
const remapBinding = (ids: Map<string, string>, binding: Binding | null): Binding | null =>
  binding && ids.has(binding.elementId) ? { ...binding, elementId: ids.get(binding.elementId) ?? '' } : null

/** The links only a text or an arrow has. */
const ownLinks = (element: Element, ids: Map<string, string>) => {
  if (isText(element)) {
    return { containerId: remap(ids, element.containerId) }
  }
  return isLinear(element)
    ? { startBinding: remapBinding(ids, element.startBinding), endBinding: remapBinding(ids, element.endBinding) }
    : {}
}

const copyOne = (
  element: Element,
  ids: Map<string, string>,
  groups: Map<string, string>,
  shift: Vec,
  z: number
): Element => {
  const links = {
    boundElements: element.boundElements.flatMap((bound) =>
      ids.has(bound.id) ? [{ ...bound, id: ids.get(bound.id) ?? '' }] : []
    ),
    groupIds: element.groupIds.map((group) => groups.get(group) ?? group),
    frameId: remap(ids, element.frameId)
  }
  return {
    ...element,
    ...links,
    ...ownLinks(element, ids),
    id: ids.get(element.id) ?? crypto.randomUUID(),
    x: element.x + shift.x,
    y: element.y + shift.y,
    z,
    seed: newSeed(),
    locked: false
  } as Element
}

/** Copies of `elements`, moved by `shift`, in front of everything, linked among themselves. */
export const cloneAll = (elements: readonly Element[], shift: Vec, top: number): Element[] => {
  const ids = new Map(elements.map((element) => [element.id, crypto.randomUUID()]))
  const groups = new Map(elements.flatMap((element) => element.groupIds).map((group) => [group, crypto.randomUUID()]))
  const ordered = [...elements].sort((a, b) => a.z - b.z)
  return ordered.map((element, index) => copyOne(element, ids, groups, shift, top + index))
}

/** The selection as clipboard text. */
export const serialize = (board: Whiteboard): string =>
  JSON.stringify({ type: MARK, elements: withTexts(board, board.selected()) })

/** Elements from clipboard text, cleaned like anything else that comes from outside; none if it is not ours. */
export const parse = (text: string): Element[] => {
  try {
    const data = JSON.parse(text) as { type?: string; elements?: unknown[] }
    return data.type === MARK && Array.isArray(data.elements) ? data.elements.flatMap((each) => clean(each) ?? []) : []
  } catch {
    return []
  }
}

/** Pasted elements land centred on `at`; pasted plain text becomes a text there. */
export const paste = (board: Whiteboard, text: string, at: Vec): void => {
  const elements = parse(text)
  if (!elements.length && text.trim()) {
    const free = {
      ...newText(
        { x: at.x, y: at.y, width: 0, height: 0 },
        { ...DEFAULT_STYLE, ...board.style },
        { ...DEFAULT_TEXT, ...board.textStyle, textAlign: 'left', verticalAlign: 'top' },
        board.scene.top
      ),
      text: text.trim()
    }
    board.scene.step(() => board.scene.put(free))
    board.select([free.id])
    return
  }
  const box = commonBounds(elements)
  const copies = cloneAll(
    elements,
    { x: at.x - (box.x + box.width / 2), y: at.y - (box.y + box.height / 2) },
    board.scene.top
  )
  board.scene.step(() => board.scene.put(...copies))
  board.select(copies.filter((element) => !(isText(element) && element.containerId)).map((element) => element.id))
}
