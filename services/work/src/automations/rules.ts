import type { CardView, StateGroup } from '../cards/schemas.js'
import type { DomainEvent } from '../events/event.js'
import type { Condition, Trigger } from './schemas.js'

/** A card's state ids, by the group each belongs to — what "into any done state" is checked against. */
export type StateGroups = ReadonlyMap<string, StateGroup>

const _stateChange = (event: DomainEvent): { before: unknown; after: unknown } | undefined => {
  const change = event.changes.stateId
  return change && change.before !== change.after ? change : undefined
}

/**
 * Whether this event is what the rule waits for. Moving a card and editing its state are the same
 * fact here: both are a `stateId` change in the trail.
 *
 * @example triggers({ type: 'state_changed', toGroup: 'done' }, movedToDone, groups)   // true
 */
export const triggers = (trigger: Trigger, event: DomainEvent, groups: StateGroups): boolean => {
  if (trigger.type === 'card_created') {
    return event.action === 'created'
  }
  if (trigger.type === 'field_changed') {
    return event.action !== 'created' && trigger.field in event.changes
  }
  const change = _stateChange(event)
  if (!change || event.action === 'created') {
    return false
  }
  const after = String(change.after)
  return (
    (!trigger.toStateId || trigger.toStateId === after) && (!trigger.toGroup || groups.get(after) === trigger.toGroup)
  )
}

/**
 * Whether the card, as it is now, passes one condition.
 *
 * @example holds({ type: 'label_has', label: 'business-form' }, card)   // true when the card has it
 */
export const holds = (condition: Condition, card: Pick<CardView, 'typeId' | 'labels' | 'priority'>): boolean => {
  if (condition.type === 'type_is') {
    return condition.typeIds.includes(card.typeId)
  }
  if (condition.type === 'label_has') {
    return card.labels.some((label) => label.toLowerCase() === condition.label.toLowerCase())
  }
  return condition.priorities.includes(card.priority)
}

export const allHold = (conditions: readonly Condition[], card: Pick<CardView, 'typeId' | 'labels' | 'priority'>) =>
  conditions.every((condition) => holds(condition, card))
