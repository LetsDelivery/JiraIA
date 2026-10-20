import { describe, expect, it } from 'vitest'

import { fileSize, fromTokens, LINK_CHOICES, mentionParts, mentionQuery, parseLinkChoice, toTokens } from './relations'

describe('links', () => {
  it('offers each reading once — "relaciona-se com" has no other end', () => {
    expect(LINK_CHOICES.map((choice) => choice.value)).toEqual([
      'relates:outward',
      'blocks:outward',
      'blocks:inward',
      'duplicates:outward',
      'duplicates:inward',
      'delivers:outward',
      'delivers:inward',
      'causes:outward',
      'causes:inward'
    ])
    expect(parseLinkChoice('delivers:inward')).toEqual({ type: 'delivers', direction: 'inward' })
  })
})

describe('mentions', () => {
  const ana = '0b6f1c2e-1111-4222-8333-444455556666'

  it('splits a body into text and mentions', () => {
    expect(mentionParts(`oi <@${ana}>, revisa?`)).toEqual([{ text: 'oi ' }, { memberId: ana }, { text: ', revisa?' }])
  })

  it('finds the name being typed after an @, and nothing in an e-mail', () => {
    expect(mentionQuery('fala @an', 8)).toEqual({ query: 'an', start: 5 })
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionQuery('ana@uselets', 11)).toBeUndefined()
  })
})

describe('fileSize', () => {
  it('reads bytes as people do', () => {
    expect(fileSize(812)).toBe('812 B')
    expect(fileSize(14 * 1024)).toBe('14 KB')
    expect(fileSize(3.2 * 1024 * 1024)).toBe('3,2 MB')
  })
})

describe('mention tokens', () => {
  const members = [
    { id: '0b6f1c2e-1111-4222-8333-444455556666', name: 'Ana' },
    { id: '0b6f1c2e-1111-4222-8333-444455556667', name: 'Ana Souza' }
  ]

  it('turns typed names into tokens, the longest name first, and back', () => {
    const body = toTokens('@Ana Souza e @Ana', members)
    expect(body).toBe(`<@${members[1]?.id}> e <@${members[0]?.id}>`)
    expect(fromTokens(body, new Map(members.map((member) => [member.id, member.name])))).toBe('@Ana Souza e @Ana')
  })
})
