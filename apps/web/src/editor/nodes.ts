import { Mark, mergeAttributes, Node } from '@tiptap/core'

import { drawRead } from '@/api/draw'
import { read, type SearchResult } from '@/api/requests'
import { html } from '@/lib/html'
import { fileSize } from '@/lib/relations'
import { spaceKeyOf } from '@/lib/search'
import { spacePath } from '@/lib/space-types'
import { icon } from '@/ui/icons'

/**
 * What a page holds beyond text (escopo-mvp 5.2, 5.5): cards — mentioned inline or embedded as a block,
 * each showing where the card stands now — images and files by id, and the mark a comment hangs on.
 */
type LiveCard = NonNullable<SearchResult['exact']>

const FRESH_MS = 15_000
const cards = new Map<string, { at: number; card: Promise<LiveCard | null> }>()

/** The card as it is now, asked again after a few seconds; `null` when the reader may not open it. */
export const liveCard = (key: string): Promise<LiveCard | null> => {
  const cached = cards.get(key)
  if (cached && Date.now() - cached.at < FRESH_MS) {
    return cached.card
  }
  const card = read
    .search(key)
    .then((found) => found.exact)
    .catch(() => null)
  cards.set(key, { at: Date.now(), card })
  return card
}

export const cardHref = (key: string): string => `${spacePath(spaceKeyOf(key))}?card=${key}`

const _cardMarkup = (key: string, title: string, card: LiveCard | null) =>
  card
    ? html`<span class="card-key">${card.key}</span><span class="card-ref-title">${card.title}</span>
      <span class="state-chip"><span class="group-dot group-${card.state.group}" aria-hidden="true"></span>${card.state.name}</span>`
    : html`<span class="card-key">${key}</span><span class="card-ref-title">${title || 'Card sem acesso'}</span>`

/** Draws a card into `dom` now and again every `FRESH_MS` while it is on the page. */
const _live = (dom: HTMLElement, key: string, title: string) => {
  const draw = () =>
    void liveCard(key).then((card) => {
      dom.innerHTML = _cardMarkup(key, title, card).value
    })
  draw()
  const timer = window.setInterval(draw, FRESH_MS)
  return { destroy: () => window.clearInterval(timer) }
}

const _keyAttributes = () => ({
  key: { default: '', parseHTML: (element: HTMLElement) => element.getAttribute('data-card') ?? '' },
  title: { default: '', parseHTML: (element: HTMLElement) => element.getAttribute('data-title') ?? '' }
})

/** A card named in a sentence: `#PRD-219` becomes a chip with its title and state. */
export const CardRef = Node.create({
  name: 'cardRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: _keyAttributes,
  parseHTML: () => [{ tag: 'a[data-card]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'a',
    mergeAttributes(HTMLAttributes, {
      'data-card': node.attrs.key,
      'data-title': node.attrs.title,
      href: cardHref(node.attrs.key),
      class: 'card-ref'
    }),
    `${node.attrs.key} ${node.attrs.title}`
  ],
  renderText: ({ node }) => `${node.attrs.key} ${node.attrs.title}`,
  addNodeView:
    () =>
    ({ node }) => {
      const dom = document.createElement('a')
      dom.className = 'card-ref'
      dom.href = cardHref(node.attrs.key)
      return { dom, ..._live(dom, node.attrs.key, node.attrs.title) }
    }
})

/** A card as a block of its own, kept up to date while the page is open. */
export const CardEmbed = Node.create({
  name: 'cardEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: _keyAttributes,
  parseHTML: () => [{ tag: 'div[data-card]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      'data-card': node.attrs.key,
      'data-title': node.attrs.title,
      class: 'card-embed'
    }),
    `${node.attrs.key} ${node.attrs.title}`
  ],
  renderText: ({ node }) => `${node.attrs.key} ${node.attrs.title}`,
  addNodeView:
    () =>
    ({ node }) => {
      const dom = document.createElement('a')
      dom.className = 'card-embed'
      dom.href = cardHref(node.attrs.key)
      dom.contentEditable = 'false'
      return { dom, ..._live(dom, node.attrs.key, node.attrs.title) }
    }
})

type FileOptions = { contentId: string }

const _fileAttributes = () => ({
  fileId: { default: '' },
  name: { default: '' },
  size: { default: 0 }
})

/** An image uploaded to the page; its address is asked for each time, as it lasts a few minutes. */
export const PageImage = Node.create<FileOptions>({
  name: 'pageImage',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({ contentId: '' }),
  addAttributes: _fileAttributes,
  parseHTML: () => [{ tag: 'figure[data-file]' }],
  renderHTML: ({ node }) => ['figure', { 'data-file': node.attrs.fileId, class: 'page-image' }, node.attrs.name],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure')
      dom.className = 'page-image'
      const image = document.createElement('img')
      image.alt = node.attrs.name
      dom.append(image)
      void drawRead.file(this.options.contentId, node.attrs.fileId).then((file) => {
        image.src = file.url
      })
      return { dom }
    }
  }
})

/** Any other file: its name and size; a click asks for a fresh address and opens it. */
export const PageFile = Node.create<FileOptions>({
  name: 'pageFile',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({ contentId: '' }),
  addAttributes: _fileAttributes,
  parseHTML: () => [{ tag: 'div[data-file]' }],
  renderHTML: ({ node }) => ['div', { 'data-file': node.attrs.fileId, class: 'page-file' }, node.attrs.name],
  renderText: ({ node }) => node.attrs.name,
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('button')
      dom.type = 'button'
      dom.className = 'page-file'
      dom.innerHTML =
        html`${icon('file', 18)}<span>${node.attrs.name}</span><small>${fileSize(node.attrs.size)}</small>`.value
      dom.addEventListener('click', () => {
        void drawRead
          .file(this.options.contentId, node.attrs.fileId)
          .then((file) => window.open(file.url, '_blank', 'noopener'))
      })
      return { dom }
    }
  }
})

/** The stretch of text a comment thread hangs on (5.7); `id` is the thread's `anchorId`. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes: () => ({
    id: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('data-comment') }
  }),
  parseHTML: () => [{ tag: 'span[data-comment]' }],
  renderHTML: ({ mark }) => ['span', { 'data-comment': mark.attrs.id, class: 'comment-anchor' }, 0]
})

/** A highlighted block — Confluence's info panel — that holds any blocks (5.2, "destaque"). */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: () => ['div', { 'data-callout': '', class: 'callout' }, 0]
})
