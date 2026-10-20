import type { Element } from './elements'
import { type Box, boundsOf, commonBounds } from './geometry'
import type { Whiteboard } from './whiteboard'

/**
 * Putting a board in order (Etapa 4d-b, ADR-0017): which element is in front, which move together,
 * and lining them up. Each is one undo step.
 */
const editable = (board: Whiteboard): Element[] =>
  board.editable ? board.selected().filter((element) => !element.locked) : []

// ---------- Layers ----------

/** The board's order with the selection moved by `place`; every element whose place changed is written. */
const reorder = (board: Whiteboard, place: (order: string[], chosen: Set<string>) => string[]): void => {
  const chosen = new Set(editable(board).map((element) => element.id))
  if (!chosen.size) {
    return
  }
  const all = board.hittable()
  const order = place(
    all.map((element) => element.id),
    chosen
  )
  const byId = new Map(all.map((element) => [element.id, element]))
  const changed = order.flatMap((id, index) => {
    const element = byId.get(id)
    return element && element.z !== index ? [{ ...element, z: index }] : []
  })
  board.scene.step(() => board.scene.put(...changed))
}

export const bringToFront = (board: Whiteboard): void =>
  reorder(board, (order, chosen) => [...order.filter((id) => !chosen.has(id)), ...order.filter((id) => chosen.has(id))])

export const sendToBack = (board: Whiteboard): void =>
  reorder(board, (order, chosen) => [...order.filter((id) => chosen.has(id)), ...order.filter((id) => !chosen.has(id))])

/** One place up: each chosen element swaps with the one just in front of it, from the front down. */
const oneUp = (order: string[], chosen: Set<string>): string[] => {
  const next = [...order]
  for (let index = next.length - 2; index >= 0; index -= 1) {
    if (chosen.has(next[index] as string) && !chosen.has(next[index + 1] as string)) {
      ;[next[index], next[index + 1]] = [next[index + 1] as string, next[index] as string]
    }
  }
  return next
}

export const bringForward = (board: Whiteboard): void => reorder(board, oneUp)

export const sendBackward = (board: Whiteboard): void =>
  reorder(board, (order, chosen) => oneUp([...order].reverse(), chosen).reverse())

// ---------- Groups ----------

/** The outermost group an element is in — the one a click selects whole. */
export const outerGroup = (element: Element): string | undefined => element.groupIds[element.groupIds.length - 1]

/** Everything in the same outermost group as each of `ids`, so a click on one picks up its group. */
export const withGroups = (elements: readonly Element[], ids: readonly string[]): string[] => {
  const groups = new Set(
    elements.filter((element) => ids.includes(element.id)).flatMap((element) => outerGroup(element) ?? [])
  )
  const members = elements.filter((element) => {
    const group = outerGroup(element)
    return group !== undefined && groups.has(group)
  })
  return [...new Set([...ids, ...members.map((element) => element.id)])]
}

export const group = (board: Whiteboard): void => {
  const chosen = editable(board)
  if (chosen.length < 2) {
    return
  }
  const id = crypto.randomUUID()
  board.scene.step(() =>
    board.scene.put(...chosen.map((element) => ({ ...element, groupIds: [...element.groupIds, id] })))
  )
}

export const ungroup = (board: Whiteboard): void => {
  const chosen = editable(board).filter((element) => element.groupIds.length)
  board.scene.step(() =>
    board.scene.put(...chosen.map((element) => ({ ...element, groupIds: element.groupIds.slice(0, -1) })))
  )
}

// ---------- Aligning and spacing ----------

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** How far an element moves so its box lines up with the selection's box on one side or axis. */
const ALIGN: Record<Alignment, (box: Box, all: Box) => [number, number]> = {
  left: (box, all) => [all.x - box.x, 0],
  center: (box, all) => [all.x + all.width / 2 - (box.x + box.width / 2), 0],
  right: (box, all) => [all.x + all.width - (box.x + box.width), 0],
  top: (box, all) => [0, all.y - box.y],
  middle: (box, all) => [0, all.y + all.height / 2 - (box.y + box.height / 2)],
  bottom: (box, all) => [0, all.y + all.height - (box.y + box.height)]
}

export const align = (board: Whiteboard, side: Alignment): void => {
  const chosen = editable(board)
  if (chosen.length < 2) {
    return
  }
  const all = commonBounds(chosen)
  const moved = chosen.map((element) => {
    const [dx, dy] = ALIGN[side](boundsOf(element), all)
    return { ...element, x: element.x + dx, y: element.y + dy }
  })
  board.scene.step(() => board.scene.put(...moved))
}

/** The same gap between each pair of neighbours, the two ends staying where they are. */
export const distribute = (board: Whiteboard, axis: 'horizontal' | 'vertical'): void => {
  const chosen = editable(board)
  if (chosen.length < 3) {
    return
  }
  const [start, size] = axis === 'horizontal' ? (['x', 'width'] as const) : (['y', 'height'] as const)
  const sorted = [...chosen].sort((a, b) => boundsOf(a)[start] - boundsOf(b)[start])
  const all = commonBounds(sorted)
  const used = sorted.reduce((sum, element) => sum + boundsOf(element)[size], 0)
  const gap = (all[size] - used) / (sorted.length - 1)
  let at = all[start]
  const moved = sorted.map((element) => {
    const box = boundsOf(element)
    const shift = at - box[start]
    at += box[size] + gap
    return { ...element, [start]: element[start] + shift }
  })
  board.scene.step(() => board.scene.put(...moved))
}
