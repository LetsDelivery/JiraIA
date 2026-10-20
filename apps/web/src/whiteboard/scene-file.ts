import { nearestAnchor } from './bindings'
import { cloneAll } from './clipboard'
import {
  type Arrowhead,
  type Binding,
  clean,
  type Element,
  type FontFamily,
  isLinear,
  isText,
  type LinearElement,
  type Point
} from './elements'
import { commonBounds } from './geometry'
import type { Whiteboard } from './whiteboard'

/**
 * A board as a file (Etapa 4d-c, ADR-0017): our own `.json` out and in, and a `.excalidraw` file in.
 * What is read is cleaned like anything else from outside; imported elements get new ids and land in the
 * middle of the screen; images inside an Excalidraw file are sent to the content's files.
 */
const FORMAT = 'jiraia/whiteboard'

export const sceneJson = (board: Whiteboard): Blob =>
  new Blob([JSON.stringify({ type: FORMAT, version: 1, ...board.scene.toJSON() }, null, 2)], {
    type: 'application/json'
  })

type Raw = Record<string, unknown>
type Excalidraw = {
  type: 'excalidraw'
  elements: Raw[]
  files?: Record<string, { dataURL?: string; mimeType?: string }>
}

/** Excalidraw's font numbers, in order from 0: Virgil and Excalifont are handwritten, Cascadia and Comic Shanns monospaced. */
const FONTS: readonly FontFamily[] = ['hand', 'hand', 'sans', 'mono', 'sans', 'hand', 'sans', 'sans', 'mono', 'sans']

const HEADS: Record<string, Arrowhead> = {
  arrow: 'arrow',
  triangle: 'triangle',
  triangle_outline: 'triangle',
  bar: 'bar',
  dot: 'dot',
  circle: 'dot',
  circle_outline: 'circle',
  diamond: 'diamond',
  diamond_outline: 'diamond',
  crowfoot_one: 'one',
  crowfoot_many: 'many',
  crowfoot_one_or_many: 'one-or-many'
}

const head = (value: unknown): Arrowhead | null => (typeof value === 'string' ? (HEADS[value] ?? 'arrow') : null)

/** Excalidraw ties an arrow by a focus and a gap; here the end ties to the nearest side, worked out on load. */
const binding = (value: unknown): Binding | null => {
  const raw = value as { elementId?: unknown; fixedPoint?: unknown } | null
  if (!raw || typeof raw.elementId !== 'string') {
    return null
  }
  const fixed = Array.isArray(raw.fixedPoint) ? (raw.fixedPoint as Point) : ([0.5, 0.5] as Point)
  return { elementId: raw.elementId, anchor: fixed }
}

/** Excalidraw bends a rounded arrow only through its middle points: with two points it is straight. */
const arrowTypeOf = (raw: Raw): string => {
  if (raw.elbowed) {
    return 'elbow'
  }
  return raw.roundness && Array.isArray(raw.points) && raw.points.length > 2 ? 'curved' : 'straight'
}

/** One Excalidraw element in our words; the fields that already match pass through. */
const fromExcalidrawElement = (raw: Raw, index: number): Raw => {
  const roundness = (raw.roundness as { type?: number } | null)?.type ? 8 : 0
  return {
    ...raw,
    z: index,
    roundness,
    fontFamily: FONTS[Number(raw.fontFamily)] ?? 'hand',
    startArrowhead: head(raw.startArrowhead),
    endArrowhead: head(raw.endArrowhead),
    startBinding: binding(raw.startBinding),
    endBinding: binding(raw.endBinding),
    arrowType: arrowTypeOf(raw),
    autoResize: raw.autoResize !== false,
    url: '',
    // Excalidraw keeps a text's original words apart from the wrapped ones.
    text: typeof raw.originalText === 'string' ? raw.originalText : raw.text
  }
}

/** Images of an Excalidraw file, sent to storage; each image element then names its stored file. */
const uploadImages = async (board: Whiteboard, data: Excalidraw, elements: Element[]): Promise<Element[]> => {
  const stored = new Map<string, string>()
  for (const [id, file] of Object.entries(data.files ?? {})) {
    if (board.files && file.dataURL?.startsWith('data:image/')) {
      const blob = await (await fetch(file.dataURL)).blob()
      stored.set(
        id,
        await board.files.upload(new File([blob], `${id}.${blob.type.split('/')[1] ?? 'png'}`, { type: blob.type }))
      )
    }
  }
  return elements.flatMap((element): Element[] => {
    if (element.type !== 'image') {
      return [element]
    }
    const fileId = stored.get(element.fileId ?? '')
    return fileId ? [{ ...element, fileId }] : []
  })
}

/** Each tied end of an Excalidraw arrow anchored to the side of its shape nearest where the end is drawn. */
const anchorEnds = (elements: Element[]): Element[] => {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const anchored = (binding: Binding | null, point: Point | undefined, element: LinearElement): Binding | null => {
    const target = binding ? byId.get(binding.elementId) : undefined
    return binding && target && point
      ? { ...binding, anchor: nearestAnchor(target, { x: element.x + point[0], y: element.y + point[1] }) }
      : null
  }
  return elements.map((element) =>
    isLinear(element)
      ? {
          ...element,
          startBinding: anchored(element.startBinding, element.points[0], element),
          endBinding: anchored(element.endBinding, element.points[element.points.length - 1], element)
        }
      : element
  )
}

/** The elements a file holds: ours, or an Excalidraw scene converted; nothing if it is neither. */
export const readScene = async (board: Whiteboard, text: string): Promise<Element[]> => {
  const data = JSON.parse(text) as Raw
  if (data.type === FORMAT && Array.isArray(data.elements)) {
    return data.elements.flatMap((each) => clean(each) ?? [])
  }
  if (data.type === 'excalidraw' && Array.isArray(data.elements)) {
    const live = (data.elements as Raw[]).filter((each) => !each.isDeleted)
    const elements = live.flatMap((each, index) => clean(fromExcalidrawElement(each, index)) ?? [])
    return await uploadImages(board, data as Excalidraw, anchorEnds(elements))
  }
  throw { error: { code: 'VALIDATION_FAILED', message: 'Not a whiteboard file' } }
}

/** A file's elements added to the board, centred on screen, selected. */
export const importScene = async (board: Whiteboard, file: File): Promise<number> => {
  const elements = await readScene(board, await file.text())
  const box = commonBounds(elements)
  const center = board.center()
  const copies = cloneAll(
    elements,
    { x: center.x - (box.x + box.width / 2), y: center.y - (box.y + box.height / 2) },
    board.scene.top
  )
  board.scene.step(() => board.scene.put(...copies))
  board.select(copies.filter((element) => !(isText(element) && element.containerId)).map((element) => element.id))
  return copies.length
}
