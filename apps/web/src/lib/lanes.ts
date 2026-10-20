import { PRIORITIES, PRIORITY_LABEL, type Priority } from './cards'

/**
 * Swimlanes (escopo-mvp 3.1): the board's second grouping, across every column. Dropping a card into
 * another lane changes that field too, as in Jira.
 */
export const LANE_BY = ['none', 'assignee', 'priority', 'type', 'parent'] as const
export type LaneBy = (typeof LANE_BY)[number]

export const LANE_LABEL: Record<LaneBy, string> = {
  none: 'Sem raias',
  assignee: 'Responsável',
  priority: 'Prioridade',
  type: 'Tipo',
  parent: 'Card pai'
}

/** The card fields a lane reads, and the field a drop into it writes. */
export const LANE_FIELD = { assignee: 'assigneeId', priority: 'priority', type: 'typeId', parent: 'parentId' } as const

export type LaneCard = {
  id: string
  key: string
  title: string
  assignee: { id: string; name: string } | null
  priority: Priority
  typeId: string
  parentId: string | null
}
export type Lane<C> = { value: string; label: string; cards: C[] }

type Names = { types: readonly { id: string; name: string }[]; cards: readonly LaneCard[] }

const _valueOf = (card: LaneCard, by: Exclude<LaneBy, 'none'>): string =>
  ({ assignee: card.assignee?.id, priority: card.priority, type: card.typeId, parent: card.parentId })[by] ?? ''

const _labelOf = (value: string, by: Exclude<LaneBy, 'none'>, names: Names, card: LaneCard): string => {
  const labels = {
    assignee: () => card.assignee?.name ?? 'Sem responsável',
    priority: () => PRIORITY_LABEL[value as Priority],
    type: () => names.types.find((type) => type.id === value)?.name ?? '—',
    parent: () => {
      const parent = names.cards.find((each) => each.id === value)
      return parent ? `${parent.key} ${parent.title}` : 'Sem card pai'
    }
  }
  return value || by === 'priority' || by === 'type' ? labels[by]() : LANE_EMPTY[by]
}

const LANE_EMPTY = { assignee: 'Sem responsável', priority: '', type: '', parent: 'Sem card pai' }

/**
 * The lanes of a board, in a stable order: priority highest first, the "nobody" lane last, the rest by
 * name. With `none`, one lane holds every card.
 */
export const lanesOf = <C extends LaneCard>(cards: readonly C[], by: LaneBy, names: Names): Lane<C>[] => {
  if (by === 'none') {
    return [{ value: '', label: '', cards: [...cards] }]
  }
  const lanes = new Map<string, Lane<C>>()
  for (const card of cards) {
    const value = _valueOf(card, by)
    const lane = lanes.get(value) ?? { value, label: _labelOf(value, by, names, card), cards: [] }
    lane.cards.push(card)
    lanes.set(value, lane)
  }
  return [...lanes.values()].sort((a, b) => _order(a, by) - _order(b, by) || a.label.localeCompare(b.label, 'pt-BR'))
}

const _order = (lane: Lane<LaneCard>, by: LaneBy): number => {
  if (by === 'priority') {
    return PRIORITIES.indexOf(lane.value as Priority)
  }
  return lane.value ? 0 : 1
}
