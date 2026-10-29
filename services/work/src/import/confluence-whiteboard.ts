import type { AdfNode } from './adf-markdown.js'
import { adfToProseMirror, textOf } from './adf-prosemirror.js'

/**
 * A Confluence whiteboard, from the site backup (ADR-0036), as the elements LET'S Draw's whiteboard
 * draws (`apps/web/src/whiteboard/elements.ts`, ADR-0017). Shapes, notes, text, connectors, pen strokes,
 * images and sections become editable elements in the same place; what Draw has no element for — a
 * stamp, a sticker, an icon, a link card — keeps its words as text where it was.
 *
 * Confluence places a node by its centre; Draw by its top-left corner. A connector tied to two nodes
 * stays tied, at the same points of their boxes, so moving a shape in Draw drags its arrows.
 */
export type BoardNode = Record<string, unknown> & { id: string; type: string }
export type BoardDocument = { nodes: Record<string, BoardNode>; edges: Record<string, BoardNode> }
export type DrawElement = Record<string, unknown> & { id: string; type: string; x: number; y: number }
export type DrawBoard = { elements: DrawElement[]; board: { background: string } }
/** An image's file on the board: Confluence's file id, and the page file it became. */
export type BoardImages = (confluenceFileId: string) => string | undefined

type Box = { x: number; y: number; width: number; height: number }
type Vec = { x: number; y: number }

const INK = '#1e1e1e'
const TRANSPARENT = 'transparent'
const BASE_FONT = 16

/** Confluence's palette names (`palette.light.blue.200`) as a fill and a stroke of the same hue. */
const HUES: Record<string, [string, string]> = {
  gray: ['#e9ecef', '#868e96'],
  blue: ['#a5d8ff', '#1971c2'],
  teal: ['#c3fae8', '#0c8599'],
  green: ['#b2f2bb', '#2f9e44'],
  lime: ['#d8f5a2', '#66a80f'],
  yellow: ['#ffec99', '#f08c00'],
  orange: ['#ffd8a8', '#e8590c'],
  red: ['#ffc9c9', '#e03131'],
  magenta: ['#fcc2d7', '#c2255c'],
  purple: ['#d0bfff', '#9c36b5']
}

const hueOf = (token: unknown): [string, string] | undefined => HUES[String(token).split('.')[2] ?? '']
const fillOf = (token: unknown): string => hueOf(token)?.[0] ?? '#ffffff'
const strokeOf = (token: unknown): string => {
  const hue = String(token).split('.')[2]
  return hue === 'gray' || !hueOf(token) ? INK : (hueOf(token)?.[1] ?? INK)
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const vec = (value: unknown): Vec => {
  const raw = (value ?? {}) as Record<string, unknown>
  return { x: num(raw.x ?? raw[0]), y: num(raw.y ?? raw[1]) }
}

/** The node's box, top-left; the exact `geometry` when there is one, the older `legacyGeometry` otherwise. */
export const boxOf = (node: BoardNode): Box => {
  const geometry = (node.geometry ?? node.legacyGeometry ?? {}) as { position?: unknown; size?: unknown }
  const centre = vec(geometry.position)
  const size = vec(geometry.size)
  return { x: centre.x - size.x / 2, y: centre.y - size.y / 2, width: size.x, height: size.y }
}

/** A node's text, kept by Confluence as an Atlassian document in a string, as plain lines. */
export const plainText = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') {
    return ''
  }
  try {
    const doc = adfToProseMirror(JSON.parse(value) as AdfNode, {
      mention: () => undefined,
      file: () => undefined,
      anchor: () => undefined
    })
    return textOf(doc)
  } catch {
    return value
  }
}

const common = (node: BoardNode, box: Box) => ({
  id: node.id,
  ...box,
  angle: (num(node.rotation) * Math.PI) / 180,
  z: num(node.zIndex),
  seed: 1 + (Math.abs([...node.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7)) % 2 ** 30),
  strokeColor: INK,
  backgroundColor: TRANSPARENT,
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: node.strokeStyle === 'dashed' || node.strokeStyle === 'dotted' ? node.strokeStyle : 'solid',
  roughness: 0,
  opacity: 100,
  roundness: 0,
  groupIds: [],
  frameId: null,
  locked: false,
  link: null,
  boundElements: [] as { id: string; type: string }[]
})

const textStyle = (node: BoardNode) => ({
  fontSize: Math.round(BASE_FONT * (num(node.fontScale) || 1)),
  fontFamily: 'sans',
  textAlign: node.alignment === 'left' ? 'left' : 'center',
  verticalAlign: node.verticalAlignment === 'top' ? 'top' : 'middle',
  lineHeight: 1.25,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none'
})

/** A text inside a shape or on an arrow: it moves and wraps with what holds it. */
const label = (holder: DrawElement, node: BoardNode, words: string, color = INK): DrawElement => ({
  ...common({ ...node, id: `${holder.id}-text` }, { x: holder.x, y: holder.y, width: num(holder.width), height: 0 }),
  z: num(holder.z) + 0.5,
  type: 'text',
  strokeColor: color,
  ...textStyle(node),
  text: words,
  containerId: holder.id,
  autoResize: false
})

/** A holder and its words, tied both ways; no words, no text element. */
const withLabel = (holder: DrawElement, node: BoardNode, words: string, color?: string): DrawElement[] => {
  if (!words.trim()) {
    return [holder]
  }
  const text = label(holder, node, words, color)
  return [{ ...holder, boundElements: [{ id: text.id, type: 'text' }] }, text]
}

const SHAPES: Record<string, 'rectangle' | 'ellipse' | 'diamond'> = {
  ellipse: 'ellipse',
  connector: 'ellipse',
  diamond: 'diamond',
  decision: 'diamond'
}
const ROUNDED = new Set(['rounded-rectangle', 'start-end', 'alternate-process', 'process'])

const shape = (node: BoardNode): DrawElement[] => {
  const kind = String(node.shape)
  const element = {
    ...common(node, boxOf(node)),
    type: SHAPES[kind] ?? 'rectangle',
    backgroundColor: node.fillEnabled === false ? TRANSPARENT : fillOf(node.color),
    strokeColor: strokeOf(node.strokeColor),
    roundness: ROUNDED.has(kind) ? 12 : 0
  }
  return withLabel(element, node, plainText(node.text))
}

/** A sticky note or a card: a filled square with its words inside. */
const note = (node: BoardNode): DrawElement[] => {
  const element = {
    ...common(node, boxOf(node)),
    type: 'rectangle',
    backgroundColor: node.type === 'card' ? '#ffffff' : fillOf(node.color),
    strokeColor: node.type === 'card' ? '#868e96' : (hueOf(node.color)?.[1] ?? '#868e96'),
    strokeWidth: 1
  }
  return withLabel(element, node, plainText(node.text))
}

const freeText = (node: BoardNode, words: string, extra: Record<string, unknown> = {}): DrawElement[] =>
  words.trim()
    ? [
        {
          ...common(node, boxOf(node)),
          type: 'text',
          strokeColor: strokeOf(node.color),
          ...textStyle(node),
          text: words,
          containerId: null,
          autoResize: true,
          ...extra
        }
      ]
    : []

const SECTION_DEPTH = 1_000_000
const STAMPS = 'Selo'
const STICKERS = 'Figurinha'

const OTHERS: Record<string, (node: BoardNode, images: BoardImages) => DrawElement[]> = {
  shape,
  sticky: note,
  card: note,
  text: (node) => freeText(node, plainText(node.text)),
  'advanced-icon': (node) => freeText(node, `[${plainText(node.text) || String(node.iconId)}]`),
  stamp: (node) => freeText(node, `[${STAMPS}: ${String(node.stampId)}]`),
  sticker: (node) => freeText(node, `[${STICKERS}: ${String(node.stickerId)}]`),
  smartLink: (node) => freeText(node, String(node.url), { link: String(node.url), textAlign: 'left' }),
  section: (node) => [
    {
      ...common(node, boxOf(node)),
      type: 'frame',
      // Behind everything, as Confluence draws its sections.
      z: num(node.zIndex) - SECTION_DEPTH,
      name: String(node.title ?? '') || 'Seção',
      strokeColor: '#868e96',
      backgroundColor: fillOf(node.color)
    }
  ],
  drawing: (node) => drawing(node),
  image: (node, images) => image(node, images)
}

/** A pen stroke: Confluence keeps its points on the board; Draw keeps them from the stroke's corner. */
const drawing = (node: BoardNode): DrawElement[] => {
  const points = (Array.isArray(node.points) ? node.points : []).map(vec)
  if (points.length === 0) {
    return []
  }
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const box = {
    x: left,
    y: top,
    width: Math.max(...points.map((point) => point.x)) - left,
    height: Math.max(...points.map((point) => point.y)) - top
  }
  return [
    {
      ...common(node, box),
      type: 'freedraw',
      strokeColor: strokeOf(node.color),
      strokeWidth: STROKES[String(node.stroke)] ?? 2,
      points: points.map((point) => [point.x - left, point.y - top])
    }
  ]
}

const image = (node: BoardNode, images: BoardImages): DrawElement[] => {
  const fileId = images(String(node.fileId ?? ''))
  return fileId
    ? [{ ...common(node, boxOf(node)), type: 'image', fileId, url: '' }]
    : freeText(node, '[Imagem do Confluence não encontrada]')
}

const STROKES: Record<string, number> = { small: 2, medium: 4, large: 6 }
const ARROW_TYPES: Record<string, string> = { dynamic: 'elbow', curved: 'curved', straight: 'straight' }

type Ends = { source?: string | undefined; target?: string | undefined; label?: BoardNode | undefined }

const anchorOf = (value: unknown): number[] => {
  const raw = (value ?? {}) as Record<string, unknown>
  return [num(raw.left ?? 0.5), num(raw.top ?? 0.5)]
}

const capOf = (value: unknown): 'arrow' | null => (value === 'arrow' ? 'arrow' : null)

/** One tied end of an arrow: the element and the point of its box, or none. */
const bindingOf = (elementId: string | undefined, anchor: unknown) =>
  elementId ? { elementId, anchor: anchorOf(anchor) } : null

/** A connector or a path: an arrow from start to end, tied to the nodes an edge names. */
const linear = (node: BoardNode, ends: Ends): DrawElement[] => {
  const start = vec(node.start)
  const end = vec(node.end)
  const heads = { startArrowhead: capOf(node.startCap), endArrowhead: capOf(node.endCap) }
  const element: DrawElement = {
    ...common(node, { x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }),
    type: heads.startArrowhead || heads.endArrowhead ? 'arrow' : 'line',
    strokeColor: strokeOf(node.color),
    strokeWidth: STROKES[String(node.stroke)] ?? 2,
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y]
    ],
    arrowType: ARROW_TYPES[String(node.presentation)] ?? 'straight',
    ...heads,
    startBinding: bindingOf(ends.source, node.sourceAnchor),
    endBinding: bindingOf(ends.target, node.targetAnchor)
  }
  return ends.label ? withLabel(element, ends.label, plainText(ends.label.text)) : [element]
}

/** Each connector's ends and label, from the edges: `association` ties ends, `attachment` a label. */
const endsOf = (document: BoardDocument): Map<string, Ends> => {
  const ends = new Map<string, Ends>()
  for (const edge of Object.values(document.edges)) {
    if (edge.type === 'association') {
      ends.set(edge.id, {
        ...ends.get(edge.id),
        source: edge.sourceNode as string | undefined,
        target: edge.targetNode as string | undefined
      })
    }
    const labelled = document.nodes[edge.id]
    if (edge.type === 'attachment' && labelled?.type === 'pathLabel') {
      ends.set(String(edge.source), { ...ends.get(String(edge.source)), label: labelled })
    }
  }
  return ends
}

/** The smallest section that holds the element whole — Draw's rule, so nothing is cut at a frame's edge. */
const frameOf = (element: DrawElement, frames: DrawElement[]): string | null => {
  const right = element.x + num(element.width)
  const bottom = element.y + num(element.height)
  const inside = frames.filter(
    (frame) =>
      element.x >= frame.x &&
      element.y >= frame.y &&
      right <= frame.x + num(frame.width) &&
      bottom <= frame.y + num(frame.height)
  )
  inside.sort((a, b) => num(a.width) * num(a.height) - num(b.width) * num(b.height))
  return inside[0]?.id ?? null
}

/** A text inside a shape or on an arrow sits in the frame of what holds it. */
const placeInFrames = (elements: DrawElement[]): DrawElement[] => {
  const frames = elements.filter((element) => element.type === 'frame')
  const placed = elements.map((element) =>
    element.type === 'frame' || element.containerId ? element : { ...element, frameId: frameOf(element, frames) }
  )
  const frameById = new Map(placed.map((element) => [element.id, element.frameId]))
  return placed.map((element) =>
    element.containerId ? { ...element, frameId: frameById.get(String(element.containerId)) ?? null } : element
  )
}

/** What Confluence keeps for itself: a connector's bend points, a mind map's root, a comment's pin. */
const SKIPPED = new Set(['pathLabel', 'pathWaypoint', 'mindmap', 'comment'])

/** The tied ends that exist on the board: an edge may name a node Confluence dropped. */
const keptEnds = (ends: Ends | undefined, nodes: Record<string, BoardNode>): Ends => ({
  ...ends,
  source: ends?.source && nodes[ends.source] ? ends.source : undefined,
  target: ends?.target && nodes[ends.target] ? ends.target : undefined
})

/** The whole board, back to front as Confluence drew it; texts tied to arrows listed on both. */
export const whiteboardToDraw = (document: BoardDocument, images: BoardImages): DrawBoard => {
  const ends = endsOf(document)
  const elements = Object.values(document.nodes).flatMap((node) => {
    if (SKIPPED.has(node.type)) {
      return []
    }
    if (node.type === 'connector' || node.type === 'path') {
      return linear(node, keptEnds(ends.get(node.id), document.nodes))
    }
    return OTHERS[node.type]?.(node, images) ?? freeText(node, plainText(node.text))
  })
  return { elements: tieArrows(placeInFrames(elements)), board: { background: '#ffffff' } }
}

/** A shape an arrow is tied to lists the arrow, so it redraws the arrow when it moves. */
const tieArrows = (elements: DrawElement[]): DrawElement[] => {
  const arrowsOf = new Map<string, string[]>()
  for (const element of elements) {
    for (const binding of [element.startBinding, element.endBinding] as ({ elementId: string } | null)[]) {
      if (binding) {
        arrowsOf.set(binding.elementId, [...(arrowsOf.get(binding.elementId) ?? []), element.id])
      }
    }
  }
  return elements.map((element) => {
    const arrows = [...new Set(arrowsOf.get(element.id) ?? [])].map((id) => ({ id, type: 'arrow' }))
    return arrows.length ? { ...element, boundElements: [...(element.boundElements as []), ...arrows] } : element
  })
}

/** A board's words, as search reads them (`content_text`). */
export const boardText = (board: DrawBoard): string =>
  board.elements
    .map((element) => String(element.type === 'frame' ? element.name : (element.text ?? '')))
    .filter((words) => words.trim())
    .join('\n')

/** The Confluence file ids of a board's images, to import as the whiteboard's files. */
export const boardImageIds = (document: BoardDocument): string[] => [
  ...new Set(
    Object.values(document.nodes)
      .filter((node) => node.type === 'image' && typeof node.fileId === 'string' && node.fileId)
      .map((node) => String(node.fileId))
  )
]
