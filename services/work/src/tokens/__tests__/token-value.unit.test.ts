import { describe, expect, it } from 'bun:test'

import { hashToken, isTokenValue, newTokenValue, tokenHint } from '../token-value.js'

describe('API token values', () => {
  it('are random, prefixed and recognisable', () => {
    const first = newTokenValue()
    expect(isTokenValue(first)).toBe(true)
    expect(first).not.toBe(newTokenValue())
    expect(tokenHint(first)).toHaveLength(12)
  })

  it('are kept as a stable hash, never as themselves', () => {
    const value = newTokenValue()
    expect(hashToken(value)).toBe(hashToken(value))
    expect(hashToken(value)).not.toContain(value.slice(4))
    expect(hashToken(value)).toHaveLength(64)
  })

  it('refuse anything without the shape', () => {
    expect(isTokenValue('Bearer x')).toBe(false)
    expect(isTokenValue('jia_short')).toBe(false)
  })
})
