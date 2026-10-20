import type { Changes } from '../audit/audit.js'
import type { CardRow, UpdateCard } from '../cards/schemas.js'
import type { ProposalItemInput } from './schemas.js'

/** A card's values by field name, custom ones as `field:<id>` — how the card's history names them. */
export type FieldValues = Record<string, unknown>

const CUSTOM = 'field:'

/** Two values are the same when their JSON is: labels compare by content; a missing value is null. */
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The values a field change would write, by field name.
 *
 * @example intendedValues({ title: 'B', customFields: { f: 1 } })   // { title: 'B', 'field:f': 1 }
 */
export const intendedValues = (changes: UpdateCard): FieldValues => {
  const { customFields, ...standard } = changes
  const values: FieldValues = Object.fromEntries(Object.entries(standard).filter(([, value]) => value !== undefined))
  for (const [id, value] of Object.entries(customFields ?? {})) {
    values[`${CUSTOM}${id}`] = value ?? null
  }
  return values
}

/** The card's values of the fields a change touches, as they are now. */
export const currentValues = (card: CardRow, changes: UpdateCard): FieldValues => {
  const custom = card.customFields as Record<string, unknown>
  const row = card as unknown as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(intendedValues(changes)).map((field) => [
      field,
      (field.startsWith(CUSTOM) ? custom[field.slice(CUSTOM.length)] : row[field]) ?? null
    ])
  )
}

/**
 * The fields whose value now is not the one in `expected`, as `{ before: expected, after: now }`.
 *
 * @example drifted({ title: 'A' }, { title: 'B' })   // { title: { before: 'A', after: 'B' } }
 */
export const drifted = (expected: FieldValues, now: FieldValues): Changes =>
  Object.fromEntries(
    Object.keys(expected)
      .filter((field) => !sameValue(expected[field], now[field]))
      .map((field) => [field, { before: expected[field] ?? null, after: now[field] ?? null }])
  )

/** Field values back into a change a card accepts — how revert writes the base again. */
export const toUpdate = (values: FieldValues): UpdateCard => {
  const customFields: Record<string, unknown> = {}
  const standard: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(values)) {
    if (field.startsWith(CUSTOM)) {
      customFields[field.slice(CUSTOM.length)] = value
    } else {
      standard[field] = value
    }
  }
  return { ...standard, ...(Object.keys(customFields).length ? { customFields } : {}) } as UpdateCard
}

/** What an item does, field by field, for the screen; a field change reads from its base. */
export const itemChanges = (input: ProposalItemInput, base: FieldValues): Changes => {
  switch (input.kind) {
    case 'create_card':
      return _created(input.card)
    case 'update_card':
      return drifted(base, intendedValues(input.changes))
    case 'comment':
      return { body: { before: null, after: input.body } }
    case 'link':
      return { link: { before: null, after: _linkValue(input.link) } }
  }
}

const _created = (card: Extract<ProposalItemInput, { kind: 'create_card' }>['card']): Changes =>
  Object.fromEntries(
    Object.entries(card)
      .filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))
      .map(([field, value]) => [field, { before: null, after: value }])
  )

const _linkValue = (link: Extract<ProposalItemInput, { kind: 'link' }>['link']) => ({
  type: link.type,
  direction: link.direction,
  card: link.key ?? link.cardId ?? null
})

/** The card an item is about, when it names one. */
export const itemCardId = (input: ProposalItemInput): string | null => ('cardId' in input ? input.cardId : null)
