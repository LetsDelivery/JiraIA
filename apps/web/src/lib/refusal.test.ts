import { describe, expect, it } from 'vitest'

import { refusalSentence } from './refusal'

const refusal = (code: string, details: Record<string, unknown>) => ({ error: { code, message: 'x', details } })

describe('refusalSentence', () => {
  it('says what access governance refused, by the field the server names', () => {
    expect(refusalSentence(refusal('VALIDATION_FAILED', { privilege: 'privileged' }))).toContain('data de validade')
    expect(refusalSentence(refusal('CONFLICT', { systemName: 'AWS' }))).toBe('Já existe um sistema chamado AWS.')
    expect(refusalSentence(refusal('CONFLICT', { heldProfile: 'Leitura' }))).toBe('A pessoa já tem o perfil Leitura.')
  })

  it('falls back to the sentence of the code', () => {
    expect(refusalSentence(refusal('VALIDATION_FAILED', {}))).toBe('Confira os campos e tente de novo.')
  })
})
