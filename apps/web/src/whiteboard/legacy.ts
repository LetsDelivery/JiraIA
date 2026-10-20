import {
  DEFAULT_STYLE,
  DEFAULT_TEXT,
  type Element,
  INK,
  newFrame,
  newFreedraw,
  newLinear,
  newShape,
  newText,
  normalizePoints,
  PALETTE,
  type Point,
  type TextElement
} from './elements'

/**
 * Boards drawn before Etapa 4d (ADR-0011) kept `shapes`: notes, boxes, ellipses, text, frames, arrows
 * and pen strokes, with a colour by name. They open as elements, so no board is lost; a note becomes a
 * filled rectangle with its text inside.
 */
export type LegacyShape = {
  id: string
  kind: 'note' | 'rect' | 'ellipse' | 'text' | 'line' | 'frame' | 'pen'
  x: number
  y: number
  w: number
  h: number
  text: string
  color: string
  points?: Point[]
}

const COLORS: Record<string, (typeof PALETTE)[number]> = {
  yellow: PALETTE[2],
  orange: PALETTE[2],
  blue: PALETTE[0],
  green: PALETTE[1],
  pink: PALETTE[3],
  purple: PALETTE[4],
  gray: PALETTE[5]
}

const paletteOf = (shape: LegacyShape) => COLORS[shape.color] ?? PALETTE[5]

const box = (shape: LegacyShape) => ({ x: shape.x, y: shape.y, width: shape.w, height: shape.h })

/** A shape's text, inside it: centred, wrapping with the shape. */
const inside = (container: Element, text: string, z: number): TextElement => ({
  ...newText(container, DEFAULT_STYLE, { ...DEFAULT_TEXT, fontSize: 18 }, z, container.id),
  id: `${container.id}-text`,
  text
})

const withText = (container: Element, text: string, z: number): Element[] => {
  if (!text.trim()) {
    return [container]
  }
  const label = inside(container, text, z + 0.5)
  return [{ ...container, boundElements: [{ id: label.id, type: 'text' }] }, label]
}

const CONVERT: Record<LegacyShape['kind'], (shape: LegacyShape, z: number) => Element[]> = {
  note: (shape, z) => {
    const { fill, stroke } = paletteOf(shape)
    const note = newShape(
      'rectangle',
      box(shape),
      { ...DEFAULT_STYLE, backgroundColor: fill, strokeColor: stroke, roughness: 0 },
      z
    )
    return withText({ ...note, id: shape.id }, shape.text, z)
  },
  rect: (shape, z) => {
    const { fill, stroke } = paletteOf(shape)
    return withText(
      {
        ...newShape('rectangle', box(shape), { ...DEFAULT_STYLE, backgroundColor: fill, strokeColor: stroke }, z),
        id: shape.id
      },
      shape.text,
      z
    )
  },
  ellipse: (shape, z) => {
    const { fill, stroke } = paletteOf(shape)
    return withText(
      {
        ...newShape('ellipse', box(shape), { ...DEFAULT_STYLE, backgroundColor: fill, strokeColor: stroke }, z),
        id: shape.id
      },
      shape.text,
      z
    )
  },
  text: (shape, z) => [
    { ...newText(box(shape), DEFAULT_STYLE, DEFAULT_TEXT, z), id: shape.id, text: shape.text, autoResize: false }
  ],
  frame: (shape, z) => [{ ...newFrame(box(shape), z), id: shape.id, name: shape.text || 'Frame' }],
  line: (shape, z) => {
    const arrow = newLinear('arrow', shape, { ...DEFAULT_STYLE, strokeColor: paletteOf(shape).stroke ?? INK }, z)
    return [normalizePoints({ ...arrow, id: shape.id, points: shape.points ?? [[0, 0]] })]
  },
  pen: (shape, z) => {
    const stroke = newFreedraw(shape, { ...DEFAULT_STYLE, strokeColor: paletteOf(shape).stroke ?? INK }, z)
    return [normalizePoints({ ...stroke, id: shape.id, points: shape.points ?? [[0, 0]] })]
  }
}

/** Frames behind everything, as the old board drew them; the rest in the order they were made. */
export const fromLegacy = (shapes: readonly LegacyShape[]): Element[] => {
  const ordered = [...shapes].sort((a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame'))
  return ordered.flatMap((shape, index) => CONVERT[shape.kind]?.(shape, index) ?? [])
}
