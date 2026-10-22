import { cloneAll, withTexts } from './clipboard'
import {
  canHoldText,
  type Element,
  isLinear,
  isText,
  type LinearElement,
  type Style,
  type TextElement,
  type TextStyle
} from './elements'
import type { Whiteboard } from './whiteboard'

/**
 * What the toolbar, the style panel and the keyboard do to the selection (ADR-0017). A locked element
 * keeps its place, size and style until it is unlocked.
 */
export type StylePatch = Partial<
  Style & TextStyle & Pick<LinearElement, 'arrowType' | 'startArrowhead' | 'endArrowhead'>
> & {
  link?: string | null
  locked?: boolean
  /** The colour of the words alone: a text's, or the text inside a shape — never the shape's stroke. */
  textColor?: string
}

const TEXT_KEYS = new Set([
  'fontSize',
  'fontFamily',
  'textAlign',
  'verticalAlign',
  'lineHeight',
  'fontWeight',
  'fontStyle',
  'textDecoration'
])
const ARROW_KEYS = new Set(['arrowType', 'startArrowhead', 'endArrowhead'])
const STYLE_KEYS = new Set([
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity',
  'roundness'
])

const pick = (patch: StylePatch, keys: Set<string>) =>
  Object.fromEntries(Object.entries(patch).filter(([key]) => keys.has(key)))

const editable = (board: Whiteboard): Element[] =>
  board.editable ? board.selected().filter((element) => !element.locked) : []

/** The texts inside the selected shapes: a font chosen for a shape is the font of its words. */
const boundTexts = (board: Whiteboard, containers: readonly Element[]): TextElement[] =>
  containers.flatMap((container) =>
    container.boundElements.flatMap((bound) => {
      const text = board.scene.get(bound.id)
      return text && isText(text) ? [text] : []
    })
  )

/**
 * A style chosen in the panel: on the selection when there is one (its texts included), and kept as the
 * style the next element is drawn with.
 */
export const applyStyle = (board: Whiteboard, patch: StylePatch): void => {
  board.style = { ...board.style, ...pick(patch, STYLE_KEYS) }
  board.textStyle = { ...board.textStyle, ...pick(patch, TEXT_KEYS) }
  board.textColor = patch.textColor ?? board.textColor
  if ('locked' in patch) {
    board.scene.put(...board.selected().map((element) => ({ ...element, locked: patch.locked === true })))
  }
  const targets = editable(board)
  const texts = boundTexts(board, targets.filter(canHoldText))
  const ownText = {
    ...pick(patch, TEXT_KEYS),
    ...(patch.textColor ? { strokeColor: patch.textColor } : {}),
    ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {})
  }
  board.scene.step(() =>
    board.scene.put(
      ...targets.map((element) => ({ ...element, ...ownPatch(element, patch) }) as Element),
      ...texts.map((text) => ({ ...text, ...ownText }) as Element)
    )
  )
  board.changed()
}

/** The part of a patch an element takes: its style, and its text or arrow settings if it has them. */
const ownPatch = (element: Element, patch: StylePatch) => ({
  ...pick(patch, STYLE_KEYS),
  ...(isText(element) ? pick(patch, TEXT_KEYS) : {}),
  ...(isText(element) && patch.textColor ? { strokeColor: patch.textColor } : {}),
  ...(isLinear(element) ? pick(patch, ARROW_KEYS) : {}),
  ...('link' in patch ? { link: patch.link ?? null } : {})
})

/** Position, size and turn typed in the panel, for one element. */
export const applyGeometry = (
  board: Whiteboard,
  patch: Partial<Pick<Element, 'x' | 'y' | 'width' | 'height' | 'angle'>>
): void => {
  const [only] = editable(board)
  if (only && board.selection.length === 1) {
    board.scene.step(() =>
      board.scene.put({ ...only, ...patch, ...(isText(only) && patch.width ? { autoResize: false } : {}) } as Element)
    )
  }
}

export const removeSelected = (board: Whiteboard): void => {
  const gone = editable(board).map((element) => element.id)
  if (gone.length) {
    board.scene.remove(gone)
    board.select([])
  }
}

/** Copies of the selection, a little down and to the right, with their texts; the copies are selected. */
export const duplicateSelected = (board: Whiteboard, offset = 16): void => {
  const originals = board.editable ? board.selected() : []
  if (!originals.length) {
    return
  }
  const copies = cloneAll(withTexts(board, originals), { x: offset, y: offset }, board.scene.top)
  board.scene.step(() => board.scene.put(...copies))
  board.select(copies.filter((element) => !(isText(element) && element.containerId)).map((element) => element.id))
}

export const nudge = (board: Whiteboard, dx: number, dy: number): void => {
  board.scene.put(...editable(board).map((element) => ({ ...element, x: element.x + dx, y: element.y + dy })))
}

export const selectAll = (board: Whiteboard): void => board.select(board.hittable().map((element) => element.id))

export const undo = (board: Whiteboard): void => {
  board.scene.undo.undo()
  board.select(board.selection)
}

export const redo = (board: Whiteboard): void => {
  board.scene.undo.redo()
  board.select(board.selection)
}
