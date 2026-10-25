import { describe, expect, it } from 'bun:test'

import { DependencyUnavailableException, describeError, knownCause, NotFoundException } from '../exception.js'

describe('describeError', () => {
  it('keeps the reason a driver hides behind its own message', () => {
    const hidden = new Error('Database returned more than the allowed response size limit')
    expect(describeError(new Error('Failed query: select …', { cause: hidden }))).toBe(
      'Error: Failed query: select … — caused by Error: Database returned more than the allowed response size limit'
    )
  })

  it('stops at a cycle, and says what a thrown non-error was', () => {
    const looped = new Error('a')
    looped.cause = looped
    expect(describeError(looped).split(' — caused by ')).toHaveLength(5)
    expect(describeError('plain')).toBe('plain')
  })
})

describe('knownCause', () => {
  it("finds the service's own exception behind a driver's wrapper, or none (ADR-0035)", () => {
    const paused = new DependencyUnavailableException('Database', 'resuming from a pause')
    expect(knownCause(new Error('Failed query: select …', { cause: paused }))).toBe(paused)
    const missing = new NotFoundException('Card', 'REQ-9')
    expect(knownCause(missing)).toBe(missing)
    expect(knownCause(new Error('Failed query', { cause: new Error('syntax error') }))).toBeUndefined()
    expect(knownCause('a string')).toBeUndefined()
  })
})
