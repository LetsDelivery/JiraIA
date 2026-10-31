import type { Attachment } from '@/api/requests'
import { type PreviewKind, previewKind, typeLabel } from '@/lib/attachments'
import { type Html, html } from '@/lib/html'

import { fileIcon } from './attachment-viewer'
import { icon } from './icons'

/** A tile is about this wide; the page is drawn for it, sharp on a retina screen. */
const THUMB_WIDTH = 240
/** Past these the whole file is not fetched only to draw a tile. */
const MAX_SNIPPET_BYTES = 512 * 1024
const MAX_PAGE_BYTES = 20 * 1024 * 1024
const LIMITS: Partial<Record<PreviewKind, number>> = { pdf: MAX_PAGE_BYTES, text: MAX_SNIPPET_BYTES }
const SNIPPET_LINES = 14

/**
 * Finished pictures by attachment, for the life of the tab. A file never changes under its id, and
 * the card draws itself again on every change — without this each draw would render the PDF anew.
 */
const drawn = new Map<string, Html>()
/** Renders under way: a draw of the card while one runs waits for it instead of starting another. */
const rendering = new Map<string, Promise<Html | undefined>>()

const glyph = (attachment: Attachment, pending: boolean): Html =>
  html`<span class="attachment-thumb attachment-glyph" ${pending ? html`data-thumb="${attachment.id}"` : ''}>${icon(fileIcon(attachment), 28)}<span class="attachment-ext">${typeLabel(attachment.name)}</span></span>`

/** Whether the tile draws the file itself after it shows — a PDF's first page, a text's first lines. */
const later = (attachment: Attachment): boolean =>
  attachment.size <= (LIMITS[previewKind(attachment.name, attachment.contentType)] ?? -1)

/** What the tile shows at once: the picture when the browser can draw it alone, else the file's glyph. */
export const thumb = (attachment: Attachment): Html => {
  const { previewUrl } = attachment
  switch (previewKind(attachment.name, attachment.contentType)) {
    case 'image':
      return html`<img class="attachment-thumb" src="${previewUrl}" alt="" loading="lazy" />`
    case 'video':
      return html`<video class="attachment-thumb" src="${previewUrl}#t=0.5" preload="metadata" muted playsinline></video>`
    default:
      return drawn.get(attachment.id) ?? glyph(attachment, later(attachment))
  }
}

const page = async (attachment: Attachment): Promise<Html> => {
  const { firstPage } = await import('@/lib/pdf-page')
  const picture = await firstPage(attachment.previewUrl, THUMB_WIDTH)
  return html`<img class="attachment-thumb attachment-page" src="${picture}" alt="" />`
}

const snippet = async (attachment: Attachment): Promise<Html> => {
  const response = await fetch(attachment.previewUrl)
  if (!response.ok) {
    throw new Error(`Attachment "${attachment.id}" answered ${response.status}`)
  }
  const head = (await response.text()).split(/\r?\n/).slice(0, SNIPPET_LINES).join('\n')
  return html`<span class="attachment-thumb attachment-snippet">${head}</span>`
}

const _render = (attachment: Attachment): Promise<Html | undefined> => {
  const pdf = previewKind(attachment.name, attachment.contentType) === 'pdf'
  const running = rendering.get(attachment.id) ?? (pdf ? page(attachment) : snippet(attachment)).catch(() => undefined)
  rendering.set(attachment.id, running)
  return running
}

/**
 * Draws the tiles still showing a glyph, one file at a time so a card full of PDFs does not start a
 * dozen renders at once. A file that fails keeps its glyph.
 */
export const fillThumbs = async (root: HTMLElement, attachments: readonly Attachment[]): Promise<void> => {
  for (const attachment of attachments) {
    // The same file can sit in the Anexos panel and in a comment that cites it.
    const slots = () => root.querySelectorAll<HTMLElement>(`[data-thumb="${attachment.id}"]`)
    const markup = slots().length ? await _render(attachment) : undefined
    if (markup) {
      drawn.set(attachment.id, markup)
      for (const slot of slots()) {
        slot.outerHTML = markup.value
      }
    }
  }
}
