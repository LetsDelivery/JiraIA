import { describe, expect, it } from 'vitest'

import { avatarType, centreSquare } from './photo'

describe('centreSquare', () => {
  it('takes the middle of a landscape picture', () => {
    expect(centreSquare(400, 300)).toEqual({ x: 50, y: 0, side: 300 })
  })

  it('takes the middle of a portrait picture', () => {
    expect(centreSquare(301, 500)).toEqual({ x: 0, y: 99, side: 301 })
  })
})

describe('avatarType', () => {
  it('keeps WebP and PNG, and calls anything else JPEG', () => {
    expect(['image/webp', 'image/png', 'image/jpeg', ''].map(avatarType)).toEqual([
      'image/webp',
      'image/png',
      'image/jpeg',
      'image/jpeg'
    ])
  })
})
