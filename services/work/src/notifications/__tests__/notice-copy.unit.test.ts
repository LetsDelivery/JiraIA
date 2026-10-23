import { describe, expect, it } from 'bun:test'

import { summaryLine } from '../notice-copy.js'
import type { NotificationWithActor } from '../notification.repository.js'

const row = (kind: string, data: Record<string, string>): NotificationWithActor => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  organizationId: '00000000-0000-4000-8000-0000000000bb',
  memberId: '00000000-0000-4000-8000-0000000000cc',
  kind,
  eventId: '00000000-0000-4000-8000-0000000000dd',
  actorId: '00000000-0000-4000-8000-0000000000ee',
  actorName: 'Ana',
  cardId: null,
  spaceId: null,
  data,
  createdAt: new Date('2026-10-17T12:00:00Z'),
  readAt: null,
  snoozedUntil: null,
  archivedAt: null,
  emailedAt: null
})

describe('a notice in one sentence', () => {
  it('says each notice in a sentence that links to its card', () => {
    expect(
      summaryLine(
        row('state_changed', { cardKey: 'PRD-4', cardTitle: 'Rastreio', stateName: 'Priorizado' }),
        'https://jiraia.test'
      )
    ).toEqual({
      sentence: 'Ana moveu PRD-4 para Priorizado',
      detail: 'Rastreio',
      url: 'https://jiraia.test/espacos/PRD?card=PRD-4'
    })
  })

  it('opens a Draw notice on its page', () => {
    const notice = { ...row('draw_mentioned', { contentId: 'c1', contentTitle: 'SLAs' }), spaceId: 's1' }
    expect(summaryLine(notice, 'https://jiraia.test')).toMatchObject({
      sentence: 'Ana mencionou você em SLAs',
      url: 'https://jiraia.test/draw/s1/c1'
    })
  })
})
