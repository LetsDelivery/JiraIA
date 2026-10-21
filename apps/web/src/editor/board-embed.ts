import { mergeAttributes, Node } from '@tiptap/core'

import { drawRead } from '@/api/draw'
import { forget } from '@/lib/cache'
import { contentPath } from '@/lib/draw'
import { html } from '@/lib/html'
import { icon } from '@/ui/icons'
import type { Element } from '@/whiteboard/elements'
import {
  clampZoom,
  fitView,
  type Preview,
  previewMarkup,
  previewOf,
  type View,
  viewBoxOf,
  zoomAt
} from '@/whiteboard/preview'

/**
 * A whiteboard shown inside a page (escopo-mvp 5.2): the board as last saved, read-only, framed whole,
 * with zoom and drag to look closer. The title opens the board itself to change it.
 */
const ZOOM_STEP = 1.25

const _attributes = () => ({
  contentId: { default: '', parseHTML: (element: HTMLElement) => element.getAttribute('data-board') ?? '' },
  spaceId: { default: '', parseHTML: (element: HTMLElement) => element.getAttribute('data-space') ?? '' },
  title: { default: '', parseHTML: (element: HTMLElement) => element.getAttribute('data-title') ?? '' }
})

type Attrs = { contentId: string; spaceId: string; title: string }

const _shell = (attrs: Attrs) => html`
  <header class="board-embed-head" draggable="true" title="Arraste por aqui para mover o bloco">
    <a class="board-embed-title" href="${contentPath(attrs.spaceId, attrs.contentId)}">${icon('chalkboard', 16)}<span data-board-title>${attrs.title || 'Quadro'}</span></a>
    <a class="button button-ghost button-small" href="${contentPath(attrs.spaceId, attrs.contentId)}">${icon('externalLink', 14)}Abrir</a>
  </header>
  <div class="board-embed-stage" data-board-stage>
    <svg class="board-embed-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${attrs.title || 'Quadro'}"></svg>
    <p class="board-embed-empty muted" data-board-empty>Carregando o quadro…</p>
    <div class="board-embed-zoom glass" role="toolbar" aria-label="Zoom">
      <button type="button" class="button button-ghost button-icon" data-zoom="in" aria-label="Aproximar" title="Aproximar">${icon('zoomIn', 16)}</button>
      <button type="button" class="board-embed-percent" data-zoom="fit" title="Ajustar à tela">100%</button>
      <button type="button" class="button button-ghost button-icon" data-zoom="out" aria-label="Afastar" title="Afastar">${icon('zoomOut', 16)}</button>
    </div>
  </div>
`

/** Images live as files of the board: their addresses are asked for, as they last a few minutes. */
const _withImages = async (boardId: string, elements: Element[]): Promise<Element[]> =>
  await Promise.all(
    elements.map(async (element) =>
      element.type === 'image' && element.fileId
        ? {
            ...element,
            url: await drawRead.file(boardId, element.fileId).then(
              (file) => file.url,
              () => ''
            )
          }
        : element
    )
  )

/** The board as stored now; the cached copy is dropped so a page opened later sees later changes. */
const _load = async (attrs: Attrs): Promise<{ title: string; preview: Preview }> => {
  forget(`draw:content:${attrs.contentId}`)
  const board = await drawRead.content(attrs.contentId)
  const preview = previewOf(board.contentJson)
  return { title: board.title, preview: { ...preview, elements: await _withImages(board.id, preview.elements) } }
}

class BoardView {
  readonly dom = document.createElement('div')
  private view: View = { x: 0, y: 0, zoom: 1 }
  private preview: Preview | undefined
  private readonly resize = new ResizeObserver(() => this.frameWhole())

  constructor(private readonly attrs: Attrs) {
    this.dom.className = 'board-embed'
    this.dom.contentEditable = 'false'
    this.dom.innerHTML = _shell(attrs).value
    this.bindZoom()
    this.bindDrag()
    this.bindWheel()
    void this.load()
  }

  private get stage(): HTMLElement {
    return this.dom.querySelector('[data-board-stage]') as HTMLElement
  }

  private get svg(): SVGSVGElement {
    return this.dom.querySelector('.board-embed-svg') as SVGSVGElement
  }

  private async load(): Promise<void> {
    try {
      const { title, preview } = await _load(this.attrs)
      this.preview = preview
      this.dom.querySelector('[data-board-title]')?.replaceChildren(title)
      this.svg.innerHTML = previewMarkup(preview.elements).value
      this.empty(preview.elements.length ? '' : 'O quadro está vazio.')
      this.resize.observe(this.stage)
    } catch {
      this.empty('Quadro indisponível — foi apagado ou você não tem acesso.')
    }
  }

  private empty(message: string): void {
    const note = this.dom.querySelector<HTMLElement>('[data-board-empty]')
    if (note) {
      note.textContent = message
      note.hidden = !message
    }
  }

  private size() {
    return { width: this.stage.clientWidth, height: this.stage.clientHeight }
  }

  private frameWhole(): void {
    if (this.preview) {
      this.show(fitView(this.preview.bounds, this.size()))
    }
  }

  private show(view: View): void {
    this.view = view
    this.svg.setAttribute('viewBox', viewBoxOf(view, this.size()))
    const percent = this.dom.querySelector('.board-embed-percent')
    if (percent) {
      percent.textContent = `${Math.round(view.zoom * 100)}%`
    }
  }

  private bindZoom(): void {
    this.dom.querySelector('.board-embed-zoom')?.addEventListener('click', (event) => {
      const which = (event.target as HTMLElement).closest<HTMLElement>('[data-zoom]')?.dataset.zoom
      if (which === 'fit') {
        this.frameWhole()
      } else if (which) {
        const zoom = clampZoom(which === 'in' ? this.view.zoom * ZOOM_STEP : this.view.zoom / ZOOM_STEP)
        this.show({ ...this.view, zoom })
      }
    })
  }

  /**
   * Dragging the stage moves the board under it, as a hand would — never the block itself, which moves
   * by its header (see the node view).
   */
  private bindDrag(): void {
    this.svg.addEventListener('mousedown', (event) => event.preventDefault())
    this.svg.addEventListener('pointerdown', (start) => {
      start.preventDefault()
      const from = { ...this.view }
      const move = (event: PointerEvent) =>
        this.show({
          ...from,
          x: from.x - (event.clientX - start.clientX) / from.zoom,
          y: from.y - (event.clientY - start.clientY) / from.zoom
        })
      this.svg.setPointerCapture(start.pointerId)
      this.svg.addEventListener('pointermove', move)
      this.svg.addEventListener('pointerup', () => this.svg.removeEventListener('pointermove', move), { once: true })
    })
  }

  /** A trackpad pinch, or ⌘/Ctrl with the wheel, zooms where the pointer is; the wheel alone scrolls the page. */
  private bindWheel(): void {
    this.svg.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey) {
          return
        }
        event.preventDefault()
        const box = this.svg.getBoundingClientRect()
        const point = { x: event.clientX - box.left, y: event.clientY - box.top }
        this.show(zoomAt(this.view, this.size(), point, this.view.zoom * Math.exp(-event.deltaY / 200)))
      },
      { passive: false }
    )
  }

  destroy(): void {
    this.resize.disconnect()
  }
}

export const BoardEmbed = Node.create({
  name: 'boardEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: _attributes,
  parseHTML: () => [{ tag: 'div[data-board]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      'data-board': node.attrs.contentId,
      'data-space': node.attrs.spaceId,
      'data-title': node.attrs.title,
      class: 'board-embed'
    }),
    node.attrs.title
  ],
  renderText: ({ node }) => `Quadro: ${node.attrs.title}`,
  addNodeView:
    () =>
    ({ node }) => {
      const view = new BoardView(node.attrs as Attrs)
      // ProseMirror makes the whole block draggable once it has it; only the header stays so.
      queueMicrotask(() => {
        view.dom.draggable = false
      })
      return {
        dom: view.dom,
        stopEvent: (event) => (event.target as HTMLElement).closest('.board-embed-stage') !== null,
        ignoreMutation: () => true,
        destroy: () => view.destroy()
      }
    }
})
