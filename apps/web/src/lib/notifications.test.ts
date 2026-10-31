import { describe, expect, it } from 'vitest'

import { channelsLabel, channelsOf, sentence, snoozeUntil, target, toggleChannel } from './notifications'

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

describe('entitlement notices', () => {
  const data = { requestId: 'r1', systemName: 'AWS', profileName: 'Leitura', personName: 'Ana', status: 'done' }

  it('names the system, the profile and the person, and what became of the request', () => {
    expect(sentence({ kind: 'entitlement_waiting', actor: { id: 'a', name: 'Bruno' }, data })).toBe(
      'Pedido de acesso esperando você: AWS · Leitura para Ana'
    )
    expect(sentence({ kind: 'entitlement_decided', actor: { id: 'a', name: 'Bruno' }, data })).toBe(
      'Pedido de acesso concluído: AWS · Leitura'
    )
  })

  it('opens the queue for whoever acts on it, and Meus acessos for whoever asked', () => {
    expect(target({ kind: 'entitlement_overdue', data, spaceId: null })).toBe('/acessos/fila')
    expect(target({ kind: 'entitlement_decided', data, spaceId: null })).toBe('/acessos')
  })
})

describe('access review notices', () => {
  it('tell the owner which system to review, and open the reviews', () => {
    const data = { reviewId: 'v1', systemName: 'AWS' }
    expect(sentence({ kind: 'access_review_opened', actor, data })).toBe('Revisão de acessos aberta: AWS')
    expect(target({ kind: 'access_review_opened', data, spaceId: null })).toBe('/acessos/revisoes')
  })
})

describe('LET’S Draw AI notices', () => {
  it('say who mentioned or changed which page, and open it', () => {
    const data = { product: 'draw' as const, contentId: 'c1', contentTitle: 'SLAs' }
    expect(sentence({ kind: 'draw_mentioned', actor: { id: 'a', name: 'Ana' }, data })).toBe(
      'Ana mencionou você em SLAs'
    )
    expect(sentence({ kind: 'content_changed', actor: { id: 'a', name: 'Ana' }, data })).toBe('Ana alterou SLAs')
    expect(target({ kind: 'content_changed', data, spaceId: 's1' })).toBe('/draw/s1/c1')
  })
})

describe('the weekly summary preference', () => {
  it('comes by e-mail or not at all', () => {
    expect(channelsOf('weekly_summary')).toEqual(['email'])
    expect(toggleChannel('weekly_summary', ['email'], 'email', false)).toEqual([])
    expect(channelsLabel('weekly_summary', [])).toBe('Não receber')
    expect(channelsLabel('weekly_summary', ['email'])).toBe('Receber por e-mail')
  })
})

describe('choosing the channels of a kind', () => {
  it('brings JiraIA along with any other channel, and keeps a fixed order', () => {
    expect(toggleChannel('mentioned', [], 'slack', true)).toEqual(['in_app', 'slack'])
    expect(toggleChannel('mentioned', ['in_app', 'slack'], 'email', true)).toEqual(['in_app', 'email', 'slack'])
    expect(toggleChannel('mentioned', ['in_app', 'email', 'slack'], 'email', false)).toEqual(['in_app', 'slack'])
  })

  it('turns everything off when JiraIA is cleared', () => {
    expect(toggleChannel('mentioned', ['in_app', 'email', 'slack'], 'in_app', false)).toEqual([])
  })

  it('names the choice in a few words', () => {
    expect(channelsLabel('mentioned', [])).toBe('Não avisar')
    expect(channelsLabel('mentioned', ['in_app'])).toBe('Só no JiraIA')
    expect(channelsLabel('mentioned', ['in_app', 'email'])).toBe('JiraIA e E-mail')
    expect(channelsLabel('mentioned', ['in_app', 'email', 'slack'])).toBe('JiraIA, E-mail e Slack')
  })
})
