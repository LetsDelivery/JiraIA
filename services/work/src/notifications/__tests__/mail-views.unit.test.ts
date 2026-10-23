import { describe, expect, it } from 'bun:test'

import type { DomainEvent } from '../../events/event.js'
import { cardChanges, trackedFields } from '../card-changes.js'
import { changedOf, openOf, updatesOf } from '../mail-views.js'
import type { NotificationWithActor } from '../notification.repository.js'

const event = (action: string, changes: DomainEvent['changes']): DomainEvent => ({
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  spaceId: null,
  actorId: '00000000-0000-4000-8000-000000000003',
  entityType: 'card',
  entityId: '00000000-0000-4000-8000-000000000004',
  action,
  changes,
  occurredAt: '2026-10-23T12:00:00.000Z'
})

const names = {
  states: new Map([
    ['s1', 'A fazer'],
    ['s2', 'Feito']
  ]),
  members: new Map([['m1', 'Ana Lima']])
}

const row = (kind: string, actorId: string, data: Record<string, unknown>, minute = 0): NotificationWithActor => ({
  id: `00000000-0000-4000-8000-0000000000${String(minute).padStart(2, '0')}`,
  organizationId: 'o',
  memberId: 'reader',
  kind,
  eventId: 'e',
  actorId,
  actorName: actorId === 'a' ? 'Ana' : 'Bruno',
  cardId: 'c',
  spaceId: 's',
  data,
  createdAt: new Date(Date.UTC(2026, 9, 23, 12, minute)),
  readAt: null,
  snoozedUntil: null,
  archivedAt: null,
  emailedAt: null
})

describe('what a card event changed', () => {
  it('names state, assignee, priority and due date in the panel’s words', () => {
    const changes = {
      stateId: { before: 's1', after: 's2' },
      assigneeId: { before: null, after: 'm1' },
      priority: { before: 'medium', after: 'highest' },
      dueDate: { before: null, after: '2026-11-30' },
      title: { before: 'a', after: 'b' }
    }
    expect(cardChanges(event('updated', changes), names)).toEqual([
      { field: 'Estado', before: 'A fazer', after: 'Feito' },
      { field: 'Responsável', before: null, after: 'Ana Lima' },
      { field: 'Prioridade', before: 'Média', after: 'Altíssima' },
      { field: 'Prazo', before: null, after: '30/11/2026' }
    ])
  })

  it('tells nothing about a card being created, nor about a field that did not move', () => {
    expect(trackedFields(event('created', { priority: { before: null, after: 'high' } }))).toEqual([])
    expect(trackedFields(event('updated', { priority: { before: 'high', after: 'high' } }))).toEqual([])
  })
})

describe('a card’s notices as the updates of one e-mail', () => {
  it('joins one person’s run of changes, and starts again after a comment or someone else', () => {
    const updates = updatesOf(
      [
        row('card_updated', 'a', { changes: [{ field: 'Prioridade', before: 'Média', after: 'Alta' }] }, 1),
        row('state_changed', 'a', { changes: [{ field: 'Estado', before: 'A fazer', after: 'Feito' }] }, 2),
        row('commented', 'b', { excerpt: 'feito!' }, 3),
        row('commented', 'b', { excerpt: 'de novo' }, 4)
      ],
      'Gil'
    )
    expect(updates.map((each) => [each.actorName, each.changes.length, each.comment ?? null])).toEqual([
      ['Ana', 2, null],
      ['Bruno', 0, 'feito!'],
      ['Bruno', 0, 'de novo']
    ])
  })

  it('says where a card moved even from a notice written before the changes were kept', () => {
    expect(updatesOf([row('state_changed', 'a', { stateName: 'Feito' })], 'Gil')[0]?.changes).toEqual([
      { field: 'Estado', before: null, after: 'Feito' }
    ])
  })

  it('says a card given on creation is now the reader’s', () => {
    expect(updatesOf([row('assigned', 'a', {})], 'Gil Souza')[0]?.changes).toEqual([
      { field: 'Responsável', before: null, after: 'Gil Souza' }
    ])
  })
})

describe('the summaries’ rows', () => {
  it('opens a Draw page and its versions, naming its editors or else whoever changed it', () => {
    const data = { contentId: 'p1', contentTitle: 'SLAs', contentKind: 'whiteboard', spaceName: 'Produto' }
    expect(changedOf(row('content_changed', 'a', data), [], 'https://jiraia.test')).toEqual({
      kind: 'board',
      title: 'SLAs',
      spaceName: 'Produto',
      url: 'https://jiraia.test/draw/s/p1',
      historyUrl: 'https://jiraia.test/draw/s/p1?painel=versoes',
      editors: ['Ana']
    })
  })

  it('links an open card ready to be taken', () => {
    expect(openOf({ key: 'PRD', number: 7, title: 'X', spaceName: 'Discovery' }, 'https://jiraia.test').assignUrl).toBe(
      'https://jiraia.test/espacos/PRD?card=PRD-7&atribuir=eu'
    )
  })
})
