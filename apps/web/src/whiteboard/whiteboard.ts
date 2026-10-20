import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

import type { Surface } from '@/editor/session'
import { html } from '@/lib/html'

import { DEFAULT_STYLE, DEFAULT_TEXT, type Element, isText, type Style, type TextStyle } from './elements'
import { refit } from './frames'
import { type Box, commonBounds, contains, hits, type Vec } from './geometry'
import type { Gesture } from './gestures'
import { type BoardFiles, ImageUrls, pickImages } from './images'
import { bindInput } from './input'
import { withGroups } from './organize'
import { paint } from './painter'
import { Scene } from './scene'
import type { Guide } from './snapping'
import { FONT_STACK } from './text-layout'
import { boardText } from './text-search'

export type Tool =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'
  | 'frame'
export type View = { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

const GRID_KEY = 'jiraia:whiteboard:grid'

/** The grid is each person's preference, kept in their browser; it works without storage too. */
const savedGrid = (): boolean => {
  try {
    return localStorage.getItem(GRID_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A whiteboard (Etapa 4d, ADR-0017): an infinite SVG canvas over the document's `elements`, shared live
 * with whoever has it open (ADR-0009). This class holds what is local — the view, the tool, the
 * selection, the gesture under way — and the commands the toolbar, the panel and the keys call.
 * Drawing lives in `painter.ts`, pointer and keys in `input.ts`.
 */
export class Whiteboard implements Surface {
  readonly root = document.createElement('div')
  readonly scene: Scene
  readonly svg: SVGSVGElement
  /** Starts right of the style panel, so nothing is drawn under it. */
  view: View = { x: 280, y: 80, zoom: 1 }
  tool: Tool = 'select'
  style: Style = { ...DEFAULT_STYLE }
  textStyle: TextStyle = { ...DEFAULT_TEXT }
  selection: string[] = []
  editing: string | null = null
  editable = false
  spaceHeld = false
  grid = savedGrid()
  gesture: Gesture | undefined
  /** The alignment lines a move has caught, drawn while it lasts. */
  guides: Guide[] = []
  /** The shape an arrow's end would tie to if released now. */
  hover: string | null = null
  /** Addresses of the images' files, asked for as they are drawn. */
  readonly images: ImageUrls
  /** What the screen around the board does on ⌘ S: save a named version. */
  onSave: () => void = () => undefined
  /** Ends the listeners the board puts on the document (the clipboard) when it closes. */
  readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private pending = 0

  constructor(
    doc: Y.Doc,
    readonly awareness: Awareness,
    user: { name: string; color: string },
    /** Where images are stored: the content's files. Without it, images cannot be added. */
    readonly files?: BoardFiles
  ) {
    this.scene = new Scene(doc)
    this.images = new ImageUrls(files, () => this.redraw())
    this.root.className = 'wb-surface'
    this.root.innerHTML = html`<svg class="wb-canvas" role="application" aria-label="Quadro branco" tabindex="0">
      <defs><pattern id="wb-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" class="wb-grid-line"></path></pattern><g class="wb-clips"></g></defs>
      <g class="wb-scene"><rect class="wb-background" x="-100000" y="-100000" width="200000" height="200000"></rect>
        <rect class="wb-grid" x="-100000" y="-100000" width="200000" height="200000" fill="url(#wb-grid)"></rect><g class="wb-elements"></g></g>
      <g class="wb-overlay"></g></svg>`.value
    this.svg = this.root.querySelector('svg') as SVGSVGElement
    awareness.setLocalStateField('user', user)
    this.scene.elements.observe(() => this.redraw())
    this.scene.board.observe(() => this.redraw())
    awareness.on('change', () => this.redraw())
    bindInput(this)
    this.setTool('select')
    this.redraw()
    // Text is measured to be wrapped: the handwritten face must be there before the first measure.
    void document.fonts?.load(`20px ${FONT_STACK.hand}`).then(() => this.redraw())
  }

  // ---------- Surface (the session's side) ----------

  derive() {
    const json = this.scene.toJSON()
    return { json, text: boardText(json.elements) }
  }

  isEmpty() {
    return this.scene.elements.size === 0 && this.scene.all().length === 0
  }

  seed(json: Record<string, unknown>) {
    this.scene.load(json)
  }

  replace(json: Record<string, unknown>) {
    this.scene.replace(json)
  }

  setEditable(editable: boolean) {
    this.editable = editable
    this.root.classList.toggle('is-readonly', !editable)
    if (editable) {
      this.scene.migrate()
    }
    this.changed()
  }

  destroy() {
    cancelAnimationFrame(this.pending)
    this.lifetime.abort()
    this.root.remove()
  }

  // ---------- What the toolbar and the style panel read and call ----------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Tells the toolbar and the panel to draw again: a tool, a selection, a style or the zoom changed. */
  changed() {
    for (const listener of this.listeners) {
      listener()
    }
  }

  get zoom(): number {
    return this.view.zoom
  }

  setTool(tool: Tool) {
    if (tool === 'image') {
      // The image tool is a file picker: the images land, and the hand goes back to selecting.
      if (this.editable) {
        pickImages(this)
      }
      return
    }
    this.tool = this.editable || tool === 'hand' ? tool : 'select'
    this.root.dataset.tool = this.tool
    if (tool !== 'select') {
      this.select([])
    }
    this.changed()
  }

  toggleGrid() {
    this.grid = !this.grid
    try {
      localStorage.setItem(GRID_KEY, this.grid ? '1' : '0')
    } catch {
      // The grid still toggles; it is just not remembered.
    }
    this.redraw()
    this.changed()
  }

  /** The selected elements, as they are now; a text inside a shape is reached through the shape. */
  selected(): Element[] {
    return this.selection.flatMap((id) => this.scene.get(id) ?? [])
  }

  /** Selects elements, and the rest of the outermost group each one is in. */
  select(ids: readonly string[]) {
    const known = ids.filter((id) => this.scene.get(id))
    this.selection = withGroups(this.hittable(), known)
    this.redraw()
    this.changed()
  }

  /** What a click can land on: every element but the texts that live inside another. */
  hittable(): Element[] {
    return this.scene.all().filter((element) => !(isText(element) && element.containerId))
  }

  /** The front-most element under a board point. */
  elementAt(point: Vec): Element | undefined {
    return [...this.hittable()].reverse().find((element) => hits(element, point, 6 / this.zoom))
  }

  /** Everything fully inside the area is selected, added to what was already selected with Shift. */
  selectArea(from: Vec, to: Vec, additive: readonly string[]) {
    const area = areaBetween(from, to)
    if (area.width < 2 && area.height < 2) {
      return this.select(additive)
    }
    const inside = this.hittable().filter((element) => contains(area, commonBounds([element])))
    this.select([...additive, ...inside.map((element) => element.id)])
  }

  /** A frame and everything in it. */
  selectWithContents(frameId: string) {
    this.select([
      frameId,
      ...this.hittable()
        .filter((element) => element.frameId === frameId)
        .map((element) => element.id)
    ])
  }

  /** Each element into the frame it now sits in, out of the one it left. */
  refitFrames(elements: readonly Element[]) {
    const changed = refit(elements, this.scene.all())
    if (changed.length) {
      this.scene.put(...changed)
    }
  }

  // ---------- The view ----------

  toBoard(event: { clientX: number; clientY: number }): Vec {
    const box = this.svg.getBoundingClientRect()
    return {
      x: (event.clientX - box.left - this.view.x) / this.zoom,
      y: (event.clientY - box.top - this.view.y) / this.zoom
    }
  }

  /** Zooms by `factor`, keeping the board point under `around` (screen) where it is. */
  zoomBy(factor: number, around?: { clientX: number; clientY: number }) {
    const box = this.svg.getBoundingClientRect()
    const screen = around
      ? { x: around.clientX - box.left, y: around.clientY - box.top }
      : { x: box.width / 2, y: box.height / 2 }
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor))
    const board = { x: (screen.x - this.view.x) / this.zoom, y: (screen.y - this.view.y) / this.zoom }
    this.view = { zoom, x: screen.x - board.x * zoom, y: screen.y - board.y * zoom }
    this.redraw()
    this.changed()
  }

  zoomTo(zoom: number) {
    this.zoomBy(zoom / this.zoom)
  }

  /** Fits the elements — the selection, or all — beside the panel, with a margin, never above 100%. */
  fit(elements: readonly Element[] = this.scene.all()) {
    if (!elements.length) {
      this.view = { x: 280, y: 80, zoom: 1 }
    } else {
      const bounds = commonBounds(elements)
      const box = this.svg.getBoundingClientRect()
      const scale = Math.min((box.width - 320) / (bounds.width || 1), (box.height - 160) / (bounds.height || 1))
      const zoom = Math.min(1, Math.max(MIN_ZOOM, scale))
      this.view = {
        zoom,
        x: 140 + box.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: box.height / 2 - (bounds.y + bounds.height / 2) * zoom
      }
    }
    this.redraw()
    this.changed()
  }

  /** The board point in the middle of what is on screen, right of the panel. */
  center(): Vec {
    const box = this.svg.getBoundingClientRect()
    return { x: (box.width / 2 + 120 - this.view.x) / this.zoom, y: (box.height / 2 - this.view.y) / this.zoom }
  }

  panBy(dx: number, dy: number) {
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy }
    this.redraw()
  }

  focus() {
    this.svg.focus({ preventScroll: true })
  }

  /** Draws at the next frame, once, however many changes arrive before it. */
  redraw() {
    if (!this.pending) {
      this.pending = requestAnimationFrame(() => {
        this.pending = 0
        paint(this)
        if (this.selection.length) {
          // The panel shows the selection's position and size: it follows what was just drawn.
          this.changed()
        }
      })
    }
  }
}

export const areaBetween = (from: Vec, to: Vec): Box => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  width: Math.abs(to.x - from.x),
  height: Math.abs(to.y - from.y)
})
