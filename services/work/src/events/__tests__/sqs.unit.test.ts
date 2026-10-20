import { describe, expect, it } from 'bun:test'

import { eventOf } from '../sqs.js'

const event = {
  id: '00000000-0000-4000-8000-0000000000aa',
  organizationId: '00000000-0000-4000-8000-0000000000bb',
  spaceId: null,
  actorId: '00000000-0000-4000-8000-0000000000dd',
  entityType: 'card',
  entityId: '00000000-0000-4000-8000-0000000000ee',
  action: 'moved',
  changes: { stateId: { before: 'a', after: 'b' } },
  occurredAt: '2026-10-17T12:00:00.000Z'
}

describe('eventOf', () => {
  it('reads our event out of the envelope EventBridge puts in the queue', () => {
    const body = JSON.stringify({ version: '0', 'detail-type': 'card.moved', source: 'jiraia.work', detail: event })
    expect(eventOf(body)).toEqual(event)
  })

  it('refuses a message that is not one of our events', () => {
    expect(() => eventOf(JSON.stringify({ 'detail-type': 'x', detail: { id: 'nope' } }))).toThrow()
  })
})
