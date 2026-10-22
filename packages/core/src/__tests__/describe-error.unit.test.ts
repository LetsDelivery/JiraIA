import { describe, expect, it } from 'bun:test'

import { describeError } from '../exception.js'

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
