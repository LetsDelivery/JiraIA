import { describe, expect, it } from 'bun:test'

import { summaryEmail, summaryLine } from '../email-copy.js'
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

describe('the daily summary', () => {
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

  it('counts in the subject and never lets a title write markup', () => {
    const lines = [
      summaryLine(row('commented', { cardKey: 'PRD-4', cardTitle: '<script>x</script>' }), 'https://jiraia.test')
    ]
    const email = summaryEmail('Gil Souza', [...lines, ...lines], 'https://jiraia.test')

    expect(email.subject).toBe('JiraIA: 2 novidades para você')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('Olá, Gil.')
  })
})
