import { describe, expect, it } from 'bun:test'

import { labelsAfter } from '../../cards/bulk.service.js'
import { instantOf, likePattern } from '../card-query.js'
import { cardFilterSchema } from '../filter.schemas.js'
import { excerpt, matchIn } from '../search.service.js'

const now = new Date('2026-10-16T12:00:00.000Z')
const card = {
  id: 'id',
  key: 'PRD-219',
  title: 'Rastreio em tempo real',
  description: 'Contexto: o lojista quer rastreio em tempo real no app',
  spaceId: 'space',
  state: { name: 'Backlog', group: 'not_started' as const }
}

describe('day bounds', () => {
  it('reads a day as its midnight in UTC and -7d as seven days before now', () => {
    expect(instantOf('2026-10-01', now).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(instantOf('-7d', now).toISOString()).toBe('2026-10-09T12:00:00.000Z')
    expect(instantOf('+2d', now).toISOString()).toBe('2026-10-18T12:00:00.000Z')
  })

  it('refuses a bound that is neither', () => {
    expect(cardFilterSchema.safeParse({ created: { from: 'ontem' } }).success).toBe(false)
    expect(cardFilterSchema.safeParse({ created: { from: '-30d' } }).success).toBe(true)
  })
})

describe('text', () => {
  it('escapes the wildcards a person types', () => {
    expect(likePattern('10%_a')).toBe('%10\\%\\_a%')
  })

  it('says where the text was found: the key, the title or the description', () => {
    expect(matchIn(card, 'prd-219').match).toBe('key')
    expect(matchIn(card, 'TEMPO').match).toBe('title')
    expect(matchIn(card, 'lojista')).toEqual({
      match: 'description',
      excerpt: 'Contexto: o lojista quer rastreio em tempo real no app'
    })
  })

  it('cuts an excerpt around the match, on one line', () => {
    expect(excerpt('Contexto: o lojista quer rastreio em tempo real', 'rastreio', 10)).toBe(
      '…ista quer rastreio em tempo …'
    )
    expect(excerpt('linha um\n\nlinha dois', 'dois')).toBe('linha um linha dois')
  })
})

describe('bulk labels', () => {
  const labelled = { labels: ['a', 'b'], spaceKey: 'PRD', number: 1 }

  it('takes some off and adds others, each once', () => {
    expect(labelsAfter(labelled, ['c', 'a'], ['b'])).toEqual(['a', 'c'])
  })

  it('refuses more than twenty labels, naming the card', () => {
    const many = Array.from({ length: 20 }, (_, index) => `l${index}`)
    expect(() => labelsAfter(labelled, many, [])).toThrow('Card "PRD-1" would have 22 labels')
  })
})
