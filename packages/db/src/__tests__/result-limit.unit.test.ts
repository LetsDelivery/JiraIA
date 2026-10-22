import { describe, expect, it } from 'bun:test'

import { assertResultSize, RESULT_LIMIT_BYTES } from '../index.js'

describe('the Data API result limit, kept locally', () => {
  it('lets a result up to 1 MiB through and refuses one past it, naming its size', () => {
    expect(() => assertResultSize([{ text: 'a'.repeat(1000) }])).not.toThrow()
    expect(() => assertResultSize([{ text: 'a'.repeat(RESULT_LIMIT_BYTES) }])).toThrow(
      /more than the allowed response size limit \(\d+ bytes\)/
    )
  })
})
