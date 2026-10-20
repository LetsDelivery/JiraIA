import { randomUUID } from 'node:crypto'

/**
 * A whiteboard drafted from a prompt (ADR-0011), in the elements the panel's whiteboard draws
 * (ADR-0017): each section a named frame, its notes filled rectangles with their text inside. The API
 * knows this much of the format only to lay a draft out; the panel cleans whatever it reads.
 */
type Element = Record<string, unknown> & {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
}

const NOTE = 180
const GAP = 20
const TOP = 60

/** The palette's fills and strokes, a section each (Stênio, 2026-10-17). */
const COLORS = [
  ['#ffec99', '#f08c00'],
  ['#a5d8ff', '#1971c2'],
  ['#b2f2bb', '#2f9e44'],
  ['#ffc9c9', '#e03131'],
  ['#d0bfff', '#9c36b5'],
  ['#c3fae8', '#0c8599']
] as const

const common = (z: number) => ({
  angle: 0,
  z,
  seed: Math.floor(Math.random() * 2 ** 31),
  strokeWidth: 2,
  strokeStyle: 'solid',
  fillStyle: 'solid',
  opacity: 100,
  groupIds: [],
  frameId: null,
  locked: false,
  link: null,
  boundElements: [] as { id: string; type: string }[]
})

const frame = (title: string, x: number, height: number, z: number): Element => ({
  ...common(z),
  id: randomUUID(),
  type: 'frame',
  x,
  y: 0,
  width: 2 * NOTE + 3 * GAP,
  height,
  name: title,
  strokeColor: '#868e96',
  backgroundColor: 'transparent',
  roughness: 0,
  roundness: 0
})

/** A note: a rectangle in the section's colour, and its words inside it, tied both ways. */
const note = (
  text: string,
  at: { x: number; y: number; frameId: string; color: readonly [string, string] },
  z: number
): Element[] => {
  const [fill, stroke] = at.color
  const box = { x: at.x, y: at.y, width: NOTE, height: NOTE }
  const shape: Element = {
    ...common(z),
    id: randomUUID(),
    type: 'rectangle',
    ...box,
    frameId: at.frameId,
    strokeColor: stroke,
    backgroundColor: fill,
    roughness: 0,
    roundness: 8
  }
  const label: Element = {
    ...common(z + 0.5),
    id: randomUUID(),
    type: 'text',
    ...box,
    frameId: at.frameId,
    text,
    fontSize: 18,
    fontFamily: 'hand',
    textAlign: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.25,
    containerId: shape.id,
    autoResize: false,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    roughness: 0,
    roundness: 0
  }
  return [{ ...shape, boundElements: [{ id: label.id, type: 'text' }] }, label]
}

/** Sections side by side, each a frame with its notes in two columns — a board someone can start moving things on. */
export const boardFromSections = (sections: { title: string; notes: string[] }[]): { elements: Element[] } => {
  const elements: Element[] = []
  for (const [column, section] of sections.entries()) {
    const x = column * (2 * NOTE + 4 * GAP)
    const rows = Math.max(1, Math.ceil(section.notes.length / 2))
    const box = frame(section.title, x, TOP + rows * (NOTE + GAP) + GAP, column - sections.length)
    elements.push(box)
    for (const [index, text] of section.notes.entries()) {
      const at = {
        x: x + GAP + (index % 2) * (NOTE + GAP),
        y: TOP + Math.floor(index / 2) * (NOTE + GAP),
        frameId: box.id,
        color: COLORS[column % COLORS.length] ?? COLORS[0]
      }
      elements.push(...note(text, at, elements.length + 1))
    }
  }
  return { elements }
}
