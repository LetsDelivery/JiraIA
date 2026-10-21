import { describe, expect, it } from 'vitest'

import { authorizeUrl, createPkce, domainsSentence, readIdToken, signInError } from './cognito'

const cognito = { domain: 'https://jiraia-761817249596.auth.us-east-1.amazoncognito.com', clientId: 'panel-client' }

const _base64url = (text: string) => Buffer.from(text).toString('base64url')

describe('signing in through Cognito (ADR-0026)', () => {
  it('derives the PKCE challenge from the verifier, as S256 asks', async () => {
    const pkce = await createPkce()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pkce.verifier))
    expect(pkce.challenge).toBe(Buffer.from(digest).toString('base64url'))
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pkce.state).not.toBe((await createPkce()).state)
  })

  it('sends the person straight to Google, with the code flow and PKCE', () => {
    const url = new URL(
      authorizeUrl(cognito, 'https://d1.cloudfront.net/entrar', { verifier: 'v', challenge: 'c', state: 's' })
    )
    expect(`${url.origin}${url.pathname}`).toBe(`${cognito.domain}/oauth2/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'panel-client',
      redirect_uri: 'https://d1.cloudfront.net/entrar',
      scope: 'openid email profile',
      identity_provider: 'Google',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256'
    })
  })

  it('reads the e-mail and the expiry the screen needs from an ID token', () => {
    const token = `${_base64url('{"alg":"RS256"}')}.${_base64url('{"email":"Ana@uselets.com","exp":1800000000}')}.sig`
    expect(readIdToken(token)).toEqual({ email: 'ana@uselets.com', expiresAt: 1_800_000_000_000 })
  })

  it('reads why the pool sent the person back without a code, and nothing on a good answer', () => {
    expect(signInError('?error=invalid_request&error_description=Login+option+is+not+available')).toBe(
      'Login option is not available'
    )
    expect(signInError('?error=access_denied')).toBe('access_denied')
    expect(signInError('?code=abc&state=s')).toBeUndefined()
  })

  it("names both LET'S domains on the sign-in screen", () => {
    expect(domainsSentence(['uselets.com', 'lets.delivery'])).toBe('@uselets.com ou @lets.delivery')
  })
})
