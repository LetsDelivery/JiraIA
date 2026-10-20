import type { Arrowhead } from './elements'
import type { Vec } from './geometry'

/**
 * The tips of lines and arrows (ADR-0017), as SVG path data at `tip`, pointing along `direction` (a unit
 * vector from the line into the tip). The cardinality tips are the crow's-foot marks of an ER diagram.
 */
export type Tip = { d: string; filled: boolean }

const at = (tip: Vec, direction: Vec, back: number, side: number): Vec => ({
  x: tip.x - direction.x * back - direction.y * side,
  y: tip.y - direction.y * back + direction.x * side
})

const move = (point: Vec) => `M${point.x.toFixed(2)} ${point.y.toFixed(2)}`
const line = (point: Vec) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`

const circle = (center: Vec, radius: number): string =>
  `M${(center.x - radius).toFixed(2)} ${center.y.toFixed(2)} a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 ${-2 * radius} 0`

const bar = (tip: Vec, direction: Vec, back: number, size: number): string =>
  `${move(at(tip, direction, back, -size / 2))}${line(at(tip, direction, back, size / 2))}`

/** Three lines fanning from a point on the line out to the tip: "many". */
const crowFoot = (tip: Vec, direction: Vec, size: number): string => {
  const root = at(tip, direction, size, 0)
  return `${move(root)}${line(at(tip, direction, 0, -size / 2))}${move(root)}${line(tip)}${move(root)}${line(at(tip, direction, 0, size / 2))}`
}

const TIPS: Record<Arrowhead, (tip: Vec, direction: Vec, size: number) => Tip> = {
  arrow: (tip, direction, size) => ({
    d: `${move(at(tip, direction, size, -size * 0.55))}${line(tip)}${line(at(tip, direction, size, size * 0.55))}`,
    filled: false
  }),
  triangle: (tip, direction, size) => ({
    d: `${move(tip)}${line(at(tip, direction, size, -size * 0.5))}${line(at(tip, direction, size, size * 0.5))}Z`,
    filled: true
  }),
  bar: (tip, direction, size) => ({ d: bar(tip, direction, 0, size), filled: false }),
  dot: (tip, direction, size) => ({ d: circle(at(tip, direction, size / 4, 0), size / 4), filled: true }),
  circle: (tip, direction, size) => ({ d: circle(at(tip, direction, size / 3, 0), size / 3), filled: false }),
  diamond: (tip, direction, size) => ({
    d: `${move(tip)}${line(at(tip, direction, size * 0.6, -size * 0.35))}${line(at(tip, direction, size * 1.2, 0))}${line(at(tip, direction, size * 0.6, size * 0.35))}Z`,
    filled: false
  }),
  one: (tip, direction, size) => ({
    d: `${bar(tip, direction, size * 0.5, size)}${bar(tip, direction, size * 0.8, size)}`,
    filled: false
  }),
  many: (tip, direction, size) => ({ d: crowFoot(tip, direction, size), filled: false }),
  'one-or-many': (tip, direction, size) => ({
    d: `${crowFoot(tip, direction, size)}${bar(tip, direction, size * 1.3, size)}`,
    filled: false
  }),
  'zero-or-one': (tip, direction, size) => ({
    d: `${bar(tip, direction, size * 0.5, size)}${circle(at(tip, direction, size * 1.2, 0), size / 3)}`,
    filled: false
  }),
  'zero-or-many': (tip, direction, size) => ({
    d: `${crowFoot(tip, direction, size)}${circle(at(tip, direction, size * 1.5, 0), size / 3)}`,
    filled: false
  })
}

/** The tip's size grows with the stroke, so a thick arrow keeps a visible head. */
export const tipSize = (strokeWidth: number): number => 10 + strokeWidth * 3

export const arrowheadPath = (kind: Arrowhead, tip: Vec, from: Vec, strokeWidth: number): Tip => {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
  const direction = { x: (tip.x - from.x) / length, y: (tip.y - from.y) / length }
  return TIPS[kind](tip, direction, tipSize(strokeWidth))
}

/** pt-BR names, for the style panel. */
export const ARROWHEAD_LABEL: Record<Arrowhead, string> = {
  arrow: 'Seta',
  triangle: 'Triângulo',
  bar: 'Barra',
  dot: 'Ponto',
  circle: 'Círculo',
  diamond: 'Losango',
  one: 'Exatamente um',
  many: 'Muitos',
  'one-or-many': 'Um ou muitos',
  'zero-or-one': 'Zero ou um',
  'zero-or-many': 'Zero ou muitos'
}
