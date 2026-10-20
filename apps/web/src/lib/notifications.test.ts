import { describe, expect, it } from 'vitest'

import { sentence, snoozeUntil, target } from './notifications'

const actor = { id: 'a', name: 'Ana' }

describe('a notice as a sentence', () => {
  it('says who did what to which card', () => {
    expect(sentence({ kind: 'state_changed', actor, data: { cardKey: 'PRD-4', stateName: 'Priorizado' } })).toBe(
      'Ana moveu PRD-4 para Priorizado'
    )
    expect(sentence({ kind: 'access_decided', actor, data: { spaceName: 'Discovery', status: 'declined' } })).toBe(
      'Seu pedido para editar Discovery foi recusado'
    )
  })

  it('opens the card it is about', () => {
    expect(target({ kind: 'mentioned', data: { cardKey: 'PRD-4' }, spaceId: 's' })).toBe('/espacos/PRD?card=PRD-4')
  })
})

describe('snoozing', () => {
  it('ends tomorrow or next Monday, at 08:00 in São Paulo', () => {
    const saturday = new Date('2026-10-17T15:00:00Z')
    expect(snoozeUntil('tomorrow', saturday)).toBe('2026-10-18T11:00:00.000Z')
    expect(snoozeUntil('next_week', saturday)).toBe('2026-10-19T11:00:00.000Z')
    expect(snoozeUntil('next_week', new Date('2026-10-19T09:00:00Z'))).toBe('2026-10-26T11:00:00.000Z')
  })
})
