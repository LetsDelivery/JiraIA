import { type Element, type FontFamily, isLinear, type TextElement } from './elements'
import { absolutePoints, type Vec } from './geometry'

/**
 * Text on a whiteboard (ADR-0017) is SVG `<text>`, one `<tspan>` per line, so it turns with its element
 * and exports to PNG and SVG as drawn. Lines are broken here, by measuring the words.
 */
export const FONT_STACK: Record<FontFamily, string> = {
  hand: "'Caveat', 'Comic Sans MS', cursive",
  sans: "'Inter Variable', Inter, system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace"
}

/** Room between a shape's outline and the text inside it. */
export const PADDING = 10

let context: CanvasRenderingContext2D | null | undefined

/** A word's width in board units; an estimate where there is no canvas (the unit tests). */
export const measure = (text: string, fontSize: number, family: FontFamily): number => {
  context ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!context) {
    return text.length * fontSize * (family === 'mono' ? 0.6 : 0.5)
  }
  context.font = `${fontSize}px ${FONT_STACK[family]}`
  return context.measureText(text).width
}

const breakWord = (word: string, width: number, size: number, family: FontFamily): string[] => {
  const pieces: string[] = []
  let piece = ''
  for (const char of word) {
    if (piece && measure(piece + char, size, family) > width) {
      pieces.push(piece)
      piece = ''
    }
    piece += char
  }
  return [...pieces, piece]
}

const wrapParagraph = (paragraph: string, width: number, size: number, family: FontFamily): string[] => {
  const lines: string[] = []
  let line = ''
  for (const word of paragraph.split(' ')) {
    const tried = line ? `${line} ${word}` : word
    if (measure(tried, size, family) <= width || !line) {
      line = tried
      continue
    }
    lines.push(line)
    line = word
  }
  lines.push(line)
  return lines.flatMap((each) => (measure(each, size, family) > width ? breakWord(each, width, size, family) : [each]))
}

/**
 * The lines a text breaks into at `width`; with no width, only at the line breaks typed.
 *
 * @example wrap('a b', 1, 20, 'mono')   // ['a', 'b']
 */
export const wrap = (text: string, width: number | null, size: number, family: FontFamily): string[] =>
  text
    .split('\n')
    .flatMap((paragraph) =>
      width === null ? [paragraph] : wrapParagraph(paragraph, Math.max(width, size), size, family)
    )

export const lineHeightOf = (text: Pick<TextElement, 'fontSize' | 'lineHeight'>): number =>
  text.fontSize * text.lineHeight

/** The size a text needs: its widest line and its lines' height. */
export const measureText = (
  text: TextElement,
  width: number | null
): { width: number; height: number; lines: string[] } => {
  const lines = wrap(text.text, width, text.fontSize, text.fontFamily)
  const widest = Math.max(text.fontSize / 2, ...lines.map((line) => measure(line, text.fontSize, text.fontFamily)))
  return { width: width ?? widest, height: Math.max(1, lines.length) * lineHeightOf(text), lines }
}

/** How much of a shape's width text may use: all of a box, less of an ellipse, half of a diamond. */
const usable = (container: Element): number => {
  const share = container.type === 'ellipse' ? 0.7 : container.type === 'diamond' ? 0.5 : 1
  return Math.max(8, container.width * share - 2 * PADDING)
}

const midpoint = (container: Element & { points: [number, number][] }): Vec => {
  const points = absolutePoints(container)
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - (points[index]?.x ?? 0), point.y - (points[index]?.y ?? 0)))
  let left = lengths.reduce((sum, each) => sum + each, 0) / 2
  for (const [index, length] of lengths.entries()) {
    if (left <= length) {
      const [a, b] = [points[index] as Vec, points[index + 1] as Vec]
      const t = length ? left / length : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= length
  }
  return points[0] ?? { x: container.x, y: container.y }
}

/** A text inside a shape, laid out in it — wrapped to its width, aligned, turned with it. */
const inShape = (text: TextElement, container: Element): TextElement => {
  const width = usable(container)
  const size = measureText(text, width)
  const room = container.height - 2 * PADDING
  const top = { top: 0, middle: (room - size.height) / 2, bottom: room - size.height }[text.verticalAlign]
  return {
    ...text,
    x: container.x + (container.width - width) / 2,
    y: container.y + PADDING + top,
    width,
    height: size.height,
    angle: container.angle
  }
}

/** An arrow's label: centred on the middle of the arrow, upright, as wide as its words. */
const onArrow = (text: TextElement, arrow: Element & { points: [number, number][] }): TextElement => {
  const size = measureText(text, null)
  const at = midpoint(arrow)
  return {
    ...text,
    x: at.x - size.width / 2,
    y: at.y - size.height / 2,
    width: size.width,
    height: size.height,
    angle: 0
  }
}

/** A free text grows to its words; one given a width wraps to it. */
const free = (text: TextElement): TextElement => {
  const size = measureText(text, text.autoResize ? null : text.width)
  return { ...text, width: size.width, height: size.height }
}

/** Where a text sits and how big it is, given its container, if it has one. */
export const layoutText = (text: TextElement, container: Element | undefined): TextElement => {
  if (!container) {
    return free(text)
  }
  return isLinear(container) ? onArrow(text, container) : inShape(text, container)
}
