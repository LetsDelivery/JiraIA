import { describe, expect, it } from 'vitest'

import type { DevLink } from '@/api/github'

import { branchName, checksOf, commitExample, commitPrefix, inReadingOrder } from './github'

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

describe('checksOf', () => {
  const link = (checks: DevLink['checks']) => ({ kind: 'pull_request', checks }) as DevLink

  it('fails when any pull request fails, then runs while any runs, then passes', () => {
    expect(checksOf([link('success'), link('failure'), link('pending')])).toBe('failure')
    expect(checksOf([link('success'), link('pending')])).toBe('pending')
    expect(checksOf([link('success'), link(null)])).toBe('success')
  })

  it('says nothing when no pull request has checks', () => {
    expect(checksOf([link(null)])).toBeNull()
    expect(checksOf([])).toBeNull()
  })
})

describe('commitPrefix', () => {
  it('scopes the type by the card’s key', () => {
    expect(commitPrefix('PRD-3', false)).toBe('feat(PRD-3):')
    expect(commitPrefix('TEC-9', true)).toBe('fix(TEC-9):')
  })
})

describe('commitExample', () => {
  it('starts the message with the prefix and keeps the title as written', () => {
    expect(commitExample('PRD-3', 'Cobrança automática de frete por região', false)).toBe(
      'git commit -m "feat(PRD-3): Cobrança automática de frete por região"'
    )
  })

  it('escapes what the shell reads inside double quotes', () => {
    expect(commitExample('REQ-12', 'Frete "grátis" de $10 `já`', true)).toBe(
      'git commit -m "fix(REQ-12): Frete \\"grátis\\" de \\$10 \\`já\\`"'
    )
  })
})
