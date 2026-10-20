import * as Y from 'yjs'

import { followBindings, withArrow } from './bindings'
import {
  type Binding,
  canHoldText,
  clean,
  type Element,
  isLinear,
  isText,
  safeColor,
  type TextElement
} from './elements'
import { fromLegacy, type LegacyShape } from './legacy'
import { layoutText, PADDING } from './text-layout'

/**
 * A whiteboard's shared state (ADR-0017): `elements`, one entry per element, and `board`, what belongs
 * to the whole board (its background). Every write goes through here, so a text tied to a shape is laid
 * out again whenever the shape changes, and undo takes back only what this person did.
 */
export type BoardSettings = { background: string }

/** The origin of this person's writes: what the undo manager tracks. Remote writes have another. */
export const LOCAL = Symbol('local')

export const DEFAULT_BACKGROUND = '#ffffff'

/**
 * A text inside a shape is drawn where its shape says, whatever position it was stored with: a board
 * loaded from JSON, or written by an older client, still shows its words in their shapes.
 */
const placeTexts = (elements: Element[]): Element[] => {
  const byId = new Map(elements.map((element) => [element.id, element]))
  return elements.map((element) =>
    isText(element) && element.containerId && byId.has(element.containerId)
      ? layoutText(element, byId.get(element.containerId))
      : element
  )
}

export class Scene {
  readonly elements: Y.Map<unknown>
  readonly board: Y.Map<unknown>
  readonly undo: Y.UndoManager
  private sorted: Element[] | undefined

  constructor(private readonly doc: Y.Doc) {
    this.elements = doc.getMap('elements')
    this.board = doc.getMap('board')
    this.undo = new Y.UndoManager([this.elements, this.board], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 300
    })
    this.elements.observe(() => {
      this.sorted = undefined
    })
  }

  /** The boards of ADR-0011 kept `shapes`. */
  private get legacy(): Y.Map<LegacyShape> {
    return this.doc.getMap<LegacyShape>('shapes')
  }

  /** Every element, cleaned, back to front. A board not yet migrated shows its old shapes converted. */
  all(): Element[] {
    if (!this.sorted) {
      const live = [...this.elements.values()].flatMap((value) => clean(value) ?? [])
      const elements = live.length || !this.legacy.size ? live : fromLegacy([...this.legacy.values()])
      this.sorted = placeTexts(elements).sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))
    }
    return this.sorted
  }

  get(id: string): Element | undefined {
    return clean(this.elements.get(id))
  }

  get settings(): BoardSettings {
    return { background: safeColor(this.board.get('background'), DEFAULT_BACKGROUND) }
  }

  setBackground(color: string): void {
    this.doc.transact(() => this.board.set('background', safeColor(color, DEFAULT_BACKGROUND)), LOCAL)
  }

  /** One change, one update to the others. Changes close together in time undo together (a drag). */
  change(write: () => void): void {
    this.doc.transact(write, LOCAL)
  }

  /** A change that is a step of its own — a delete, a duplicate, a style — never merged with the last. */
  step(write: () => void): void {
    this.undo.stopCapturing()
    this.change(write)
    this.undo.stopCapturing()
  }

  get top(): number {
    return Math.max(0, ...this.all().map((element) => element.z)) + 1
  }

  get bottom(): number {
    return Math.min(0, ...this.all().map((element) => element.z)) - 1
  }

  /** Writes elements; a shape's bound text follows it, and a text laid out in a shape grows the shape. */
  put(...elements: Element[]): void {
    this.change(() => {
      for (const element of elements) {
        this.elements.set(element.id, element)
      }
      for (const element of elements) {
        this.follow(element)
      }
    })
  }

  /** What hangs on an element is redrawn with it: its texts, and the arrows tied to it. */
  private follow(element: Element): void {
    if (isText(element)) {
      this.layout(element)
      return
    }
    if (isLinear(element)) {
      this.elements.set(
        element.id,
        followBindings(element, (id) => this.get(id))
      )
    }
    for (const other of element.boundElements.flatMap((bound) => this.get(bound.id) ?? [])) {
      this.hang(element, other)
    }
  }

  /** One thing hanging on `element`: a text laid out again, or an arrow drawn again from its anchors. */
  private hang(element: Element, other: Element): void {
    if (isText(other)) {
      this.layout(other)
    } else if (isLinear(other) && !isLinear(element)) {
      this.follow(other)
    }
  }

  /** Ties an arrow's end to an element, or unties it (`null`), and keeps both sides' lists right. */
  tie(arrowId: string, end: 'startBinding' | 'endBinding', binding: Binding | null): void {
    const arrow = this.get(arrowId)
    if (!arrow || !isLinear(arrow)) {
      return
    }
    const previous = arrow[end]?.elementId
    const other = arrow[end === 'startBinding' ? 'endBinding' : 'startBinding']?.elementId
    // The shape let go of keeps the arrow in its list only if the arrow's other end is still on it.
    const released = previous && previous !== other && previous !== binding?.elementId ? previous : undefined
    this.change(() => {
      this.elements.set(arrow.id, { ...arrow, [end]: binding })
      this.list(released, arrow.id, false)
      this.list(binding?.elementId, arrow.id, true)
      this.follow(this.get(arrow.id) as Element)
    })
  }

  private list(elementId: string | undefined, arrowId: string, tied: boolean): void {
    const element = elementId ? this.get(elementId) : undefined
    if (element) {
      this.elements.set(element.id, withArrow(element, arrowId, tied))
    }
  }

  /** A text placed where its container says; a container too short for its text is made taller. */
  private layout(text: TextElement): void {
    const container = text.containerId ? this.get(text.containerId) : undefined
    const placed = layoutText(text, container)
    this.elements.set(text.id, placed)
    const needed = placed.height + 2 * PADDING
    if (container && canHoldText(container) && container.type !== 'arrow' && container.height < needed) {
      this.elements.set(container.id, { ...container, height: needed })
      this.elements.set(text.id, layoutText(placed, { ...container, height: needed }))
    }
  }

  /** Removes elements, the texts inside them, and every tie to them: a shape's arrows stay, untied. */
  remove(ids: readonly string[]): void {
    const gone = new Set(ids)
    for (const id of ids) {
      for (const bound of this.get(id)?.boundElements ?? []) {
        if (bound.type === 'text') {
          gone.add(bound.id)
        }
      }
    }
    this.step(() => {
      for (const id of gone) {
        this.untie(id, gone)
        this.elements.delete(id)
      }
    })
  }

  /** Before an element goes: out of its container's list, its arrows' ends, and its shapes' lists. */
  private untie(id: string, gone: ReadonlySet<string>): void {
    const element = this.get(id)
    if (!element) {
      return
    }
    const partners = [
      ...(isText(element) && element.containerId ? [element.containerId] : []),
      ...(isLinear(element)
        ? [element.startBinding?.elementId, element.endBinding?.elementId].flatMap((each) => each ?? [])
        : []),
      ...element.boundElements.filter((each) => each.type === 'arrow').map((each) => each.id)
    ]
    for (const partner of partners.filter((each) => !gone.has(each))) {
      this.forget(partner, id)
    }
  }

  /** `partner` no longer refers to `id`: out of its list, and, for an arrow, its end left where it is. */
  private forget(partnerId: string, id: string): void {
    const partner = this.get(partnerId)
    if (!partner) {
      return
    }
    const unbound = isLinear(partner)
      ? {
          startBinding: partner.startBinding?.elementId === id ? null : partner.startBinding,
          endBinding: partner.endBinding?.elementId === id ? null : partner.endBinding
        }
      : {}
    this.elements.set(partner.id, {
      ...partner,
      ...unbound,
      boundElements: partner.boundElements.filter((each) => each.id !== id)
    } as Element)
  }

  /** The old shapes rewritten as elements, once, by the first person who can edit the board. */
  migrate(): void {
    if (this.elements.size || !this.legacy.size) {
      return
    }
    const converted = fromLegacy([...this.legacy.values()])
    this.doc.transact(() => {
      for (const element of converted) {
        this.elements.set(element.id, element)
      }
      this.legacy.clear()
    })
  }

  /** What the session stores beside the document: for search, versions and the API. */
  toJSON(): { elements: Element[]; board: BoardSettings } {
    return { elements: this.all(), board: this.settings }
  }

  /** An empty board filled from stored JSON: the new format, or the shapes of an older board or draft. */
  load(json: Record<string, unknown>): void {
    const elements = Array.isArray(json.elements)
      ? json.elements.flatMap((value) => clean(value) ?? [])
      : fromLegacy((json.shapes as LegacyShape[] | undefined) ?? [])
    const board = (json.board ?? {}) as Partial<BoardSettings>
    this.doc.transact(() => {
      for (const element of elements) {
        this.elements.set(element.id, element)
      }
      if (board.background) {
        this.board.set('background', safeColor(board.background, DEFAULT_BACKGROUND))
      }
    })
  }

  /** A version restored: the board becomes that version, as one change everyone receives. */
  replace(json: Record<string, unknown>): void {
    this.doc.transact(() => {
      this.elements.clear()
      this.legacy.clear()
      this.load(json)
    }, LOCAL)
  }
}
