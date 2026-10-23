import type { DomainEvent } from '../events/event.js'
import type { CardChange } from './schemas.js'

/** The fields a card's e-mail tells about, in the order it lists them (Etapa 5f). */
const TRACKED = ['stateId', 'assigneeId', 'priority', 'dueDate'] as const
type Tracked = (typeof TRACKED)[number]

const FIELD: Record<Tracked, string> = {
  stateId: 'Estado',
  assigneeId: 'Responsável',
  priority: 'Prioridade',
  dueDate: 'Prazo'
}

/** The panel's words for each priority (apps/web lib/cards.ts). */
const PRIORITY: Record<string, string> = {
  highest: 'Altíssima',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  lowest: 'Baixíssima'
}

/** What turns an id into the name a person reads. */
export type ChangeNames = { states: ReadonlyMap<string, string>; members: ReadonlyMap<string, string> }

/** "2026-11-30" → "30/11/2026"; a date has no time, so no zone moves it. */
const _date = (value: string): string => value.split('-').reverse().join('/')

const _word = (field: Tracked, value: unknown, names: ChangeNames): string | null => {
  if (typeof value !== 'string' || value === '') {
    return null
  }
  const words: Record<Tracked, () => string> = {
    stateId: () => names.states.get(value) ?? value,
    assigneeId: () => names.members.get(value) ?? 'alguém',
    priority: () => PRIORITY[value] ?? value,
    dueDate: () => _date(value)
  }
  return words[field]()
}

/** Which tracked fields an event changed; a card being created changes nothing anyone follows yet. */
export const trackedFields = (event: DomainEvent): Tracked[] =>
  event.action === 'created'
    ? []
    : TRACKED.filter((field) => {
        const change = event.changes[field]
        return change !== undefined && change.before !== change.after
      })

/**
 * The tracked fields an event changed, as the e-mail shows them.
 *
 * @example cardChanges(movedEvent, names)   // [{ field: 'Estado', before: 'A fazer', after: 'Feito' }]
 */
export const cardChanges = (event: DomainEvent, names: ChangeNames): CardChange[] =>
  trackedFields(event).map((field) => ({
    field: FIELD[field],
    before: _word(field, event.changes[field]?.before, names),
    after: _word(field, event.changes[field]?.after, names)
  }))
