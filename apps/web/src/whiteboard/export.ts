import caveat from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url'
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

import { html, raw } from '@/lib/html'

import { withTexts } from './clipboard'
import { type Element, isText } from './elements'
import { contentsOf, isFrame } from './frames'
import { commonBounds } from './geometry'
import { clipsMarkup, elementsMarkup } from './painter'
import type { Whiteboard } from './whiteboard'

/**
 * Taking a board out (Etapa 4d-c, ADR-0017): an SVG that stands on its own — its fonts and images inside
 * it — and a PNG drawn from that SVG. The whole board or the selection, on the board's background or
 * transparent. Colours are the board's own, whatever theme is on screen.
 */
export type ExportOptions = { onlySelected: boolean; transparent: boolean }

const PADDING = 24
/** A PNG is drawn at twice the size, so it stays sharp on a dense screen or a slide. */
const PNG_SCALE = 2

const asDataUrl = async (url: string): Promise<string | undefined> => {
  try {
    const blob = await (await fetch(url)).blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

/** What is exported: the selection with its texts and what its frames hold, or everything. */
const chosen = (board: Whiteboard, onlySelected: boolean): Element[] => {
  if (!onlySelected || !board.selection.length) {
    return board.scene.all()
  }
  const selected = withTexts(board, board.selected())
  const frames = new Set(selected.filter(isFrame).map((frame) => frame.id))
  const held = withTexts(board, contentsOf(frames, board.scene.all()))
  const ids = new Set([...selected, ...held].map((element) => element.id))
  return board.scene.all().filter((element) => ids.has(element.id))
}

/** Images carried inside the file, so it opens anywhere; one that cannot be read is left out. */
const inlineImages = async (board: Whiteboard, elements: readonly Element[]): Promise<Element[]> =>
  await Promise.all(
    elements.map(async (element) => {
      if (element.type !== 'image' || !element.fileId || !board.files) {
        return element
      }
      const url = await board.files.url(element.fileId)
      return { ...element, url: (await asDataUrl(url)) ?? '' }
    })
  )

/** The faces the texts use, inside the file as data, so the words look as they do on the board. */
const fontFaces = async (elements: readonly Element[]): Promise<string> => {
  const families = new Set(elements.filter(isText).map((text) => text.fontFamily))
  const faces = [
    families.has('hand') ? ['Caveat', caveat] : undefined,
    families.has('sans') ? ['Inter Variable', inter] : undefined
  ].flatMap((each) => each ?? [])
  const rules = await Promise.all(
    faces.map(
      async ([family, url]) => `@font-face{font-family:'${family}';src:url(${(await asDataUrl(url as string)) ?? ''})}`
    )
  )
  return rules.join('')
}

/** The board, or the selection, as an SVG document, with its size in pixels. */
export const exportSvg = async (
  board: Whiteboard,
  options: ExportOptions
): Promise<{ svg: string; width: number; height: number }> => {
  const elements = await inlineImages(board, chosen(board, options.onlySelected))
  const bounds = commonBounds(elements)
  const [width, height] = [Math.ceil(bounds.width + 2 * PADDING), Math.ceil(bounds.height + 2 * PADDING)]
  const background = options.transparent
    ? ''
    : html`<rect x="${bounds.x - PADDING}" y="${bounds.y - PADDING}" width="${width}" height="${height}" fill="${board.scene.settings.background}"></rect>`
  const svg =
    html`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x - PADDING} ${bounds.y - PADDING} ${width} ${height}">
<defs><style>${raw(await fontFaces(elements))}.wb-frame-name{fill:#868e96;font-family:'Inter Variable',sans-serif}</style>${clipsMarkup(elements)}</defs>
${background}${elementsMarkup(elements)}</svg>`.value
  return { svg, width, height }
}

/** The SVG drawn on a canvas, twice the size, as a PNG. */
export const exportPng = async (board: Whiteboard, options: ExportOptions): Promise<Blob> => {
  const { svg, width, height } = await exportSvg(board, options)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = Object.assign(document.createElement('canvas'), {
      width: width * PNG_SCALE,
      height: height * PNG_SCALE
    })
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The board could not be drawn as PNG'))),
        'image/png'
      )
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A file saved by the browser, named after the board. */
export const download = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The PNG on the clipboard, to paste into a chat, a slide or a document. */
export const copyPng = async (board: Whiteboard, options: ExportOptions): Promise<void> => {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPng(board, options) })])
}

/** A name a file can have: the board's title without the characters file systems refuse. */
export const fileName = (title: string, extension: string): string =>
  `${
    title
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'quadro'
  }.${extension}`
