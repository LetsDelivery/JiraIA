import { describe, expect, it } from 'vitest'

import { contentPath, drawSpacePath } from './draw'

describe('Let’s Draw AI addresses', () => {
  it('puts a space and its content under /draw, by id', () => {
    expect(drawSpacePath('s1')).toBe('/draw/s1')
    expect(contentPath('s1', 'c1')).toBe('/draw/s1/c1')
  })
})
