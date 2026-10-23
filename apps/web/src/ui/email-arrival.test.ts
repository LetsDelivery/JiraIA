import { describe, expect, it } from 'vitest'

import { arrival } from './email-arrival'

describe('arrival from an e-mail', () => {
  it('asks for the comment box and drops the hash', () => {
    expect(arrival(new URL('https://jiraia.test/espacos/PRD?card=PRD-1#comentar'))).toEqual({
      focus: 'comment',
      clean: 'https://jiraia.test/espacos/PRD?card=PRD-1'
    })
  })

  it('points at taking the card, keeping the card in the address', () => {
    expect(arrival(new URL('https://jiraia.test/espacos/PRD?card=PRD-1&atribuir=eu'))).toEqual({
      focus: 'assign',
      clean: 'https://jiraia.test/espacos/PRD?card=PRD-1'
    })
  })

  it('asks nothing of an ordinary link', () => {
    expect(arrival(new URL('https://jiraia.test/espacos/PRD?card=PRD-1')).focus).toBeNull()
  })
})
