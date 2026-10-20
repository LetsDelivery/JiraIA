import { describe, expect, it } from 'vitest'

import { consentRequest } from './consent'

const params = (extra: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: 'code',
    client_id: 'c1',
    redirect_uri: 'https://app.example/cb',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    ...extra
  })

describe('consentRequest', () => {
  it('reads the request, keeping state and resource when sent', () => {
    expect(consentRequest(params({ state: 's', resource: 'https://api/v1/mcp' }))).toEqual({
      ok: true,
      request: {
        clientId: 'c1',
        redirectUri: 'https://app.example/cb',
        codeChallenge: 'abc',
        codeChallengeMethod: 'S256',
        state: 's',
        resource: 'https://api/v1/mcp'
      }
    })
  })

  it('refuses a request without PKCE or without a client', () => {
    expect(consentRequest(params({ code_challenge_method: 'plain' })).ok).toBe(false)
    expect(consentRequest(new URLSearchParams()).ok).toBe(false)
  })
})
