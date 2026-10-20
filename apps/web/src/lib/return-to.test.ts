import { describe, expect, it } from 'vitest'

import { rememberReturn, takeReturn } from './return-to'

const memory = () => {
  const values = new Map<string, string>()
  return {
    setItem: (key: string, value: string) => void values.set(key, value),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key)
  }
}

describe('return after sign-in', () => {
  it('goes back once to the page opened signed out', () => {
    const storage = memory()
    rememberReturn(storage, '/oauth/autorizar?client_id=1')
    expect(takeReturn(storage)).toBe('/oauth/autorizar?client_id=1')
    expect(takeReturn(storage)).toBe('/')
  })

  it('never leaves the panel', () => {
    const storage = memory()
    rememberReturn(storage, '//evil.example/x')
    expect(takeReturn(storage)).toBe('/')
  })
})
