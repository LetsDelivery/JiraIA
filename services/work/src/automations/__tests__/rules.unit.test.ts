import { describe, expect, it } from 'bun:test'

import type { DomainEvent } from '../../events/event.js'
import { allHold, holds, triggers } from '../rules.js'
import { fill } from '../template.js'

const DONE = '00000000-0000-4000-8000-000000000001'
const DOING = '00000000-0000-4000-8000-000000000002'
const groups = new Map([
  [DONE, 'done' as const],
  [DOING, 'in_progress' as const]
])

const event = (action: string, changes: DomainEvent['changes'] = {}): DomainEvent => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  organizationId: '00000000-0000-4000-8000-0000000000bb',
  spaceId: '00000000-0000-4000-8000-0000000000cc',
  actorId: '00000000-0000-4000-8000-0000000000dd',
  entityType: 'card',
  entityId: '00000000-0000-4000-8000-0000000000ee',
  action,
  changes,
  occurredAt: '2026-10-17T12:00:00.000Z'
})

describe('triggers', () => {
  it('fires on a card created only for that rule', () => {
    expect(triggers({ type: 'card_created' }, event('created'), groups)).toBe(true)
    expect(triggers({ type: 'card_created' }, event('updated'), groups)).toBe(false)
  })

  it('fires on a move into the named state or into a state of the named group', () => {
    const moved = event('moved', { stateId: { before: DOING, after: DONE } })
    expect(triggers({ type: 'state_changed', toStateId: DONE }, moved, groups)).toBe(true)
    expect(triggers({ type: 'state_changed', toGroup: 'done' }, moved, groups)).toBe(true)
    expect(triggers({ type: 'state_changed', toGroup: 'in_progress' }, moved, groups)).toBe(false)
    expect(
      triggers({ type: 'state_changed' }, event('updated', { priority: { before: 'low', after: 'high' } }), groups)
    ).toBe(false)
  })

  it('fires on a field changed, never on the card being created', () => {
    const changed = event('updated', { priority: { before: 'low', after: 'high' } })
    expect(triggers({ type: 'field_changed', field: 'priority' }, changed, groups)).toBe(true)
    expect(triggers({ type: 'field_changed', field: 'priority' }, event('created', changed.changes), groups)).toBe(
      false
    )
  })
})

describe('conditions', () => {
  const card = { typeId: DONE, labels: ['Business-Form'], priority: 'high' as const }

  it('checks the type, a label in any case, and the priority', () => {
    expect(holds({ type: 'type_is', typeIds: [DONE] }, card)).toBe(true)
    expect(holds({ type: 'label_has', label: 'business-form' }, card)).toBe(true)
    expect(holds({ type: 'priority_is', priorities: ['low'] }, card)).toBe(false)
    expect(allHold([], card)).toBe(true)
  })
})

describe('fill', () => {
  it('fills known blanks and empties unknown ones', () => {
    expect(
      fill('{{card.key}} → {{created.key}}{{nothing.here}}', { card: { key: 'REQ-1' }, created: { key: 'PRD-9' } })
    ).toBe('REQ-1 → PRD-9')
  })
})
