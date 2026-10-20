/**
 * A whiteboard's scene (Etapa 4d, ADR-0017): every element is an independent object, one entry of the
 * document's `elements` map, so two people editing two elements never touch the same entry. `x`, `y`
 * is the top-left of the element's box before rotation; `angle` turns it around its centre, in radians.
 * A line's, an arrow's and a stroke's `points` are relative to `x`, `y`.
 */
export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'text'
  | 'freedraw'
  | 'image'
  | 'frame'
export type FillStyle = 'solid' | 'hachure' | 'cross-hatch' | 'zigzag'
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type FontFamily = 'hand' | 'sans' | 'mono'
export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type Arrowhead =
  | 'arrow'
  | 'triangle'
  | 'bar'
  | 'dot'
  | 'circle'
  | 'diamond'
  | 'one'
  | 'many'
  | 'one-or-many'
  | 'zero-or-one'
  | 'zero-or-many'
export type ArrowType = 'straight' | 'curved' | 'elbow'
export type Point = [number, number]

/** Where an arrow's end is tied: an element, and a point on its box from [0, 0] (top-left) to [1, 1]. */
export type Binding = { elementId: string; anchor: Point }
export type BoundElement = { id: string; type: 'text' | 'arrow' }

export type Style = {
  strokeColor: string
  backgroundColor: string
  fillStyle: FillStyle
  strokeWidth: number
  strokeStyle: StrokeStyle
  /** 0 architect, 1 artist, 2 cartoonist. */
  roughness: number
  /** 0 to 100. */
  opacity: number
  /** Corner radius in board units; 0 is a sharp corner. */
  roundness: number
}

export type TextStyle = {
  fontSize: number
  fontFamily: FontFamily
  textAlign: TextAlign
  verticalAlign: VerticalAlign
  lineHeight: number
}

export type ElementBase = Style & {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  angle: number
  /** Drawing order: higher is in front. A number between two others puts an element between them. */
  z: number
  /** Fixes the hand-drawn wobble, so the same element looks the same on every screen. */
  seed: number
  groupIds: string[]
  frameId: string | null
  locked: boolean
  link: string | null
  boundElements: BoundElement[]
}

export type ShapeElement = ElementBase & { type: 'rectangle' | 'ellipse' | 'diamond' }
export type TextElement = ElementBase &
  TextStyle & {
    type: 'text'
    text: string
    /** The shape or arrow this text sits in; it moves and wraps with it. */
    containerId: string | null
    /** Free text grows with what is typed until someone sets its width. */
    autoResize: boolean
  }
export type LinearElement = ElementBase & {
  type: 'line' | 'arrow'
  points: Point[]
  arrowType: ArrowType
  startArrowhead: Arrowhead | null
  endArrowhead: Arrowhead | null
  startBinding: Binding | null
  endBinding: Binding | null
}
export type FreedrawElement = ElementBase & { type: 'freedraw'; points: Point[] }
export type ImageElement = ElementBase & { type: 'image'; fileId: string | null; url: string }
export type FrameElement = ElementBase & { type: 'frame'; name: string }

export type Element = ShapeElement | TextElement | LinearElement | FreedrawElement | ImageElement | FrameElement

export const isLinear = (element: Element): element is LinearElement =>
  element.type === 'line' || element.type === 'arrow'
export const isShape = (element: Element): element is ShapeElement =>
  element.type === 'rectangle' || element.type === 'ellipse' || element.type === 'diamond'
export const isText = (element: Element): element is TextElement => element.type === 'text'
export const hasPoints = (element: Element): element is LinearElement | FreedrawElement =>
  isLinear(element) || element.type === 'freedraw'
/** What can hold a text: the three shapes, and an arrow, whose text is its label. */
export const canHoldText = (element: Element): boolean => isShape(element) || element.type === 'arrow'

/** The semantic palette (Stênio, 2026-10-17): a fill and a stroke per meaning. */
export const PALETTE = [
  { name: 'Padrão', fill: '#a5d8ff', stroke: '#1971c2' },
  { name: 'Sucesso', fill: '#b2f2bb', stroke: '#2f9e44' },
  { name: 'Aviso', fill: '#ffec99', stroke: '#f08c00' },
  { name: 'Erro', fill: '#ffc9c9', stroke: '#e03131' },
  { name: 'Externo', fill: '#d0bfff', stroke: '#9c36b5' },
  { name: 'Neutro', fill: '#e9ecef', stroke: '#868e96' },
  { name: 'Armazenamento', fill: '#c3fae8', stroke: '#0c8599' }
] as const

export const INK = '#1e1e1e'
export const TRANSPARENT = 'transparent'

export const STROKE_WIDTHS = { thin: 1, normal: 2, bold: 4, extra: 6 } as const

export const DEFAULT_STYLE: Style = {
  strokeColor: INK,
  backgroundColor: TRANSPARENT,
  fillStyle: 'solid',
  strokeWidth: STROKE_WIDTHS.normal,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  roundness: 8
}

export const DEFAULT_TEXT: TextStyle = {
  fontSize: 20,
  fontFamily: 'hand',
  textAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25
}

export const newSeed = (): number => Math.floor(Math.random() * 2 ** 31)

const base = (
  type: ElementType,
  at: { x: number; y: number; width: number; height: number },
  style: Style,
  z: number
) => ({
  ...style,
  id: crypto.randomUUID(),
  type,
  // Only the box: `at` may be a whole element (a text made inside a shape), whose id must not leak in.
  x: at.x,
  y: at.y,
  width: at.width,
  height: at.height,
  angle: 0,
  z,
  seed: newSeed(),
  groupIds: [],
  frameId: null,
  locked: false,
  link: null,
  boundElements: []
})

type Box = { x: number; y: number; width: number; height: number }

export const newShape = (type: ShapeElement['type'], box: Box, style: Style, z: number): ShapeElement =>
  ({ ...base(type, box, style, z), type }) as ShapeElement

export const newText = (
  box: Box,
  style: Style,
  text: TextStyle,
  z: number,
  containerId: string | null = null
): TextElement => ({
  ...base('text', box, { ...style, backgroundColor: TRANSPARENT }, z),
  ...text,
  type: 'text',
  text: '',
  containerId,
  autoResize: containerId === null,
  ...(containerId ? {} : { textAlign: 'left' as const, verticalAlign: 'top' as const })
})

export const newLinear = (
  type: LinearElement['type'],
  at: { x: number; y: number },
  style: Style,
  z: number
): LinearElement => ({
  ...base(type, { ...at, width: 0, height: 0 }, { ...style, backgroundColor: TRANSPARENT }, z),
  type,
  points: [
    [0, 0],
    [0, 0]
  ],
  arrowType: 'straight',
  startArrowhead: null,
  endArrowhead: type === 'arrow' ? 'arrow' : null,
  startBinding: null,
  endBinding: null
})

export const newFreedraw = (at: { x: number; y: number }, style: Style, z: number): FreedrawElement => ({
  ...base('freedraw', { ...at, width: 0, height: 0 }, { ...style, backgroundColor: TRANSPARENT }, z),
  type: 'freedraw',
  points: [[0, 0]]
})

export const newFrame = (box: Box, z: number): FrameElement => ({
  ...base('frame', box, { ...DEFAULT_STYLE, strokeColor: '#868e96', roughness: 0, roundness: 0 }, z),
  type: 'frame',
  name: 'Frame'
})

export const newImage = (box: Box, url: string, fileId: string | null, z: number): ImageElement => ({
  ...base('image', box, { ...DEFAULT_STYLE, strokeColor: TRANSPARENT }, z),
  type: 'image',
  url,
  fileId
})

/** A line's or a stroke's box from its points, with the points made relative to the new corner. */
export const normalizePoints = <T extends LinearElement | FreedrawElement>(element: T): T => {
  const xs = element.points.map(([px]) => px)
  const ys = element.points.map(([, py]) => py)
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)]
  return {
    ...element,
    x: element.x + minX,
    y: element.y + minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    points: element.points.map(([px, py]) => [px - minX, py - minY] as Point)
  }
}

// ---------- What another client wrote is data, never markup ----------

const COLOR = /^(#[0-9a-fA-F]{3,8}|transparent)$/
const ARROWHEADS: readonly Arrowhead[] = [
  'arrow',
  'triangle',
  'bar',
  'dot',
  'circle',
  'diamond',
  'one',
  'many',
  'one-or-many',
  'zero-or-one',
  'zero-or-many'
]

export const safeColor = (color: unknown, fallback = INK): string =>
  typeof color === 'string' && COLOR.test(color) ? color : fallback

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const points = (value: unknown): Point[] =>
  Array.isArray(value) ? value.map((point) => [num(point?.[0]), num(point?.[1])] as Point) : [[0, 0]]

const head = (value: unknown): Arrowhead | null => (value === null ? null : oneOf(value, ARROWHEADS, 'arrow'))

/** The numbers and words the drawing writes into SVG, held to what they may be. */
const cleanStyle = (raw: Record<string, unknown>): Style => ({
  strokeColor: safeColor(raw.strokeColor),
  backgroundColor: safeColor(raw.backgroundColor, TRANSPARENT),
  fillStyle: oneOf(raw.fillStyle, ['solid', 'hachure', 'cross-hatch', 'zigzag'], 'solid'),
  strokeWidth: Math.min(32, Math.max(0.5, num(raw.strokeWidth, 2))),
  strokeStyle: oneOf(raw.strokeStyle, ['solid', 'dashed', 'dotted'], 'solid'),
  roughness: Math.min(2, Math.max(0, num(raw.roughness, 1))),
  opacity: Math.min(100, Math.max(0, num(raw.opacity, 100))),
  roundness: Math.max(0, num(raw.roundness))
})

type Raw = Record<string, unknown>

const binding = (value: unknown): Binding | null => {
  const raw = value as Partial<Binding> | null
  return raw && typeof raw.elementId === 'string'
    ? { elementId: raw.elementId, anchor: [num(raw.anchor?.[0], 0.5), num(raw.anchor?.[1], 0.5)] }
    : null
}

const cleanText = (raw: Raw) => ({
  text: String(raw.text ?? ''),
  fontSize: Math.min(400, Math.max(4, num(raw.fontSize, 20))),
  fontFamily: oneOf(raw.fontFamily, ['hand', 'sans', 'mono'], 'hand'),
  textAlign: oneOf(raw.textAlign, ['left', 'center', 'right'], 'left'),
  verticalAlign: oneOf(raw.verticalAlign, ['top', 'middle', 'bottom'], 'top'),
  lineHeight: Math.min(4, Math.max(0.8, num(raw.lineHeight, 1.25))),
  containerId: typeof raw.containerId === 'string' ? raw.containerId : null,
  autoResize: raw.autoResize !== false
})

const cleanLinear = (raw: Raw) => ({
  points: points(raw.points),
  arrowType: oneOf(raw.arrowType, ['straight', 'curved', 'elbow'], 'straight'),
  startArrowhead: head(raw.startArrowhead ?? null),
  endArrowhead: head(raw.endArrowhead ?? null),
  startBinding: binding(raw.startBinding),
  endBinding: binding(raw.endBinding)
})

const IMAGE_URL = /^(https?:|blob:|data:image\/)/

/** What each type adds to the common fields. */
const BY_TYPE: Record<ElementType, (raw: Raw) => Raw> = {
  text: cleanText,
  line: cleanLinear,
  arrow: cleanLinear,
  freedraw: (raw) => ({ points: points(raw.points) }),
  image: (raw) => ({
    url: IMAGE_URL.test(String(raw.url)) ? String(raw.url) : '',
    fileId: typeof raw.fileId === 'string' ? raw.fileId : null
  }),
  frame: (raw) => ({ name: String(raw.name ?? 'Frame') }),
  rectangle: () => ({}),
  ellipse: () => ({}),
  diamond: () => ({})
}

const TYPES: readonly ElementType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'text',
  'freedraw',
  'image',
  'frame'
]

const bound = (value: unknown): BoundElement[] =>
  Array.isArray(value)
    ? value.flatMap((each) =>
        typeof each?.id === 'string' ? [{ id: each.id, type: oneOf(each.type, ['text', 'arrow'], 'arrow') }] : []
      )
    : []

/** Where an element is, what it belongs to, and the switches every element has. */
const cleanPlace = (raw: Raw) => ({
  x: num(raw.x),
  y: num(raw.y),
  width: Math.max(0, num(raw.width)),
  height: Math.max(0, num(raw.height)),
  angle: num(raw.angle),
  z: num(raw.z),
  seed: num(raw.seed, 1),
  groupIds: Array.isArray(raw.groupIds) ? raw.groupIds.map(String) : [],
  frameId: typeof raw.frameId === 'string' ? raw.frameId : null,
  locked: raw.locked === true,
  link: typeof raw.link === 'string' && /^https?:\/\//.test(raw.link) ? raw.link : null,
  boundElements: bound(raw.boundElements)
})

/** An element as read from the shared document; one of an unknown type is dropped. */
export const clean = (value: unknown): Element | undefined => {
  const raw = (value ?? {}) as Raw
  const type = raw.type as ElementType
  if (!TYPES.includes(type) || typeof raw.id !== 'string') {
    return undefined
  }
  return { ...cleanStyle(raw), id: raw.id, type, ...cleanPlace(raw), ...BY_TYPE[type](raw) } as Element
}
