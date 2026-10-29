import { describe, expect, it } from 'vitest'

import type { DevLink } from '@/api/github'

import { branchName, inReadingOrder } from './github'

describe('branchName', () => {
  it('joins the key and the title, without accents or symbols', () => {
    expect(branchName('REQ-12', 'Frete por região — São Paulo!', false)).toBe('feat/REQ-12-frete-por-regiao-sao-paulo')
  })

  it('starts a bug’s branch with fix/', () => {
    expect(branchName('TEC-3', 'Erro no login', true)).toBe('fix/TEC-3-erro-no-login')
  })

  it('cuts a long title at a word boundary of hyphens, and keeps the key when nothing is left', () => {
    const long = branchName('REQ-1', 'Uma descrição muito longa de uma tarefa que não cabe no nome', false)
    expect(long.length).toBeLessThanOrEqual('feat/REQ-1-'.length + 40)
    expect(long.endsWith('-')).toBe(false)
    expect(branchName('REQ-1', '🚀', false)).toBe('feat/REQ-1')
  })
})

describe('inReadingOrder', () => {
  it('puts pull requests before branches', () => {
    const link = (kind: DevLink['kind'], ref: string) => ({ kind, ref }) as DevLink
    const ordered = inReadingOrder([link('branch', 'b'), link('pull_request', '7')])
    expect(ordered.map((each) => each.ref)).toEqual(['7', 'b'])
  })
})
