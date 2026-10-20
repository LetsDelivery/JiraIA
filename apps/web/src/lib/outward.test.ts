import { describe, expect, it } from 'vitest'

import { deliveryDetail, tokenState } from './outward'

describe('a token now', () => {
  const now = new Date('2026-10-17T12:00:00Z')

  it('is revoked, expired or active', () => {
    expect(tokenState({ revokedAt: '2026-10-01T00:00:00Z', expiresAt: null }, now)).toBe('revoked')
    expect(tokenState({ revokedAt: null, expiresAt: '2026-10-17T11:59:00Z' }, now)).toBe('expired')
    expect(tokenState({ revokedAt: null, expiresAt: null }, now)).toBe('active')
  })
})

describe('a delivery in a line', () => {
  it('says how many tries and what came back', () => {
    expect(deliveryDetail({ status: 'delivered', attempts: 1, lastStatus: 200 })).toBe('1 tentativa · HTTP 200')
    expect(deliveryDetail({ status: 'pending', attempts: 2, lastStatus: 503 })).toBe(
      '2 tentativas · respondeu HTTP 503'
    )
    expect(deliveryDetail({ status: 'failed', attempts: 6, lastStatus: null })).toBe('6 tentativas · sem resposta')
  })
})
