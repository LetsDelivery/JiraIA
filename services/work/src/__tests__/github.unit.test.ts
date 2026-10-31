import { describe, expect, it } from 'bun:test'
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto'

import { appJwt, pemOf } from '../github/github-api.js'
import { checksAfter, keysOf, pullState, type ReviewEvent, reviewOf } from '../github/payloads.js'
import { fromGitHub, InstallState } from '../github/signatures.js'

/** Etapa 9 (ADR-0038): what JiraIA reads from GitHub, with nothing but the functions. */
const SECRET = 'webhook-secret-of-the-app'

describe('a delivery’s signature', () => {
  const body = '{"zen":"Keep it logically awesome."}'
  const signed = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`

  it('accepts the body GitHub signed with the secret', () => {
    expect(fromGitHub(SECRET, body, signed)).toBe(true)
  })

  it('refuses another body, another secret, and no signature', () => {
    expect(fromGitHub(SECRET, `${body} `, signed)).toBe(false)
    expect(fromGitHub('another-secret-of-16', body, signed)).toBe(false)
    expect(fromGitHub(SECRET, body, undefined)).toBe(false)
  })
})

describe('the installation’s state', () => {
  const state = new InstallState(SECRET)
  const now = new Date('2026-10-29T12:00:00Z')

  it('comes back good for who started it, within ten minutes', () => {
    expect(() => state.check(state.issue('admin', now), 'admin', new Date('2026-10-29T12:09:00Z'))).not.toThrow()
  })

  it('is refused for someone else, late, or forged', () => {
    const issued = state.issue('admin', now)
    expect(() => state.check(issued, 'ana', now)).toThrow('started by someone else')
    expect(() => state.check(issued, 'admin', new Date('2026-10-29T12:11:00Z'))).toThrow('expired')
    expect(() => state.check(issued.replace('admin', 'ana'), 'ana', now)).toThrow('expired')
  })
})

describe('the keys a branch or pull request names', () => {
  it('reads them in the branch and the title, upper case, once each', () => {
    expect(keysOf('feat/req-12-frete', 'REQ-12 e TEC-3: frete')).toEqual(['REQ-12', 'TEC-3'])
  })

  it('reads the key a conventional commit scopes its type by', () => {
    expect(keysOf('feat/PRD-3-cobranca-de-frete', 'feat(PRD-3): Cobrança automática de frete')).toEqual(['PRD-3'])
    expect(keysOf('fix/TEC-9-login', 'fix(tec-9): Erro no login')).toEqual(['TEC-9'])
  })

  it('reads none from a branch without one', () => {
    expect(keysOf('master', 'Atualiza dependências')).toEqual([])
  })
})

describe('a pull request’s state', () => {
  const pull = { state: 'open', draft: false, merged: false, merged_at: null }

  it('is merged, closed, draft or open', () => {
    expect(pullState({ ...pull, state: 'closed', merged: true })).toBe('merged')
    expect(pullState({ ...pull, state: 'closed' })).toBe('closed')
    expect(pullState({ ...pull, draft: true })).toBe('draft')
    expect(pullState(pull)).toBe('open')
  })
})

describe('a review', () => {
  const review = (action: string, state: string) => ({ action, review: { state } }) as ReviewEvent

  it('approves or asks for changes; a comment says nothing; a dismissal clears it', () => {
    expect(reviewOf(review('submitted', 'APPROVED'))).toBe('approved')
    expect(reviewOf(review('submitted', 'changes_requested'))).toBe('changes_requested')
    expect(reviewOf(review('submitted', 'commented'))).toBeUndefined()
    expect(reviewOf(review('dismissed', 'approved'))).toBeNull()
  })
})

describe('the checks of a commit', () => {
  it('are pending when asked for, and failed when any suite fails', () => {
    expect(checksAfter('requested', null, 'failure')).toBe('pending')
    expect(checksAfter('completed', 'timed_out', null)).toBe('failure')
    expect(checksAfter('completed', 'success', 'failure')).toBe('failure')
    expect(checksAfter('completed', 'success', 'pending')).toBe('success')
    expect(checksAfter('in_progress', null, null)).toBeUndefined()
  })
})

describe('the App’s token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

  it('is a JWT signed with the private key, issued by the App, dated a minute back', () => {
    const token = appJwt({ appId: '123', privateKey: pem }, new Date('2026-10-29T12:00:00Z'))
    const [header = '', claims = '', signature = ''] = token.split('.')
    const verified = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url')
    expect(verified).toBe(true)
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iat: 1_793_275_140,
      exp: 1_793_275_740,
      iss: '123'
    })
  })

  it('takes a key whose line breaks were written as \\n', () => {
    expect(pemOf(pem.replace(/\n/g, '\\n'))).toBe(pem)
  })
})
