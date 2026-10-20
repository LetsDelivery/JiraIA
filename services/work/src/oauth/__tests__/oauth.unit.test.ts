import { describe, expect, it } from 'bun:test'

import { authorizationServerMetadata, mcpChallenge, mcpResource, publicBase } from '../metadata.js'
import { registerClientSchema } from '../schemas.js'
import { newAccessToken, pkceMatches } from '../secrets.js'

describe('PKCE', () => {
  it('matches the verifier of RFC 7636’s example, and nothing else', () => {
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    expect(pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', challenge)).toBe(true)
    expect(pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl', challenge)).toBe(false)
    expect(pkceMatches('x', 'short')).toBe(false)
  })

  it('issues tokens that say what they are', () => {
    expect(newAccessToken()).toMatch(/^jioa_[A-Za-z0-9_-]{43}$/)
  })
})

describe('the public address and the documents', () => {
  it('takes the configured address, or the request’s host, without a trailing slash', () => {
    expect(publicBase('http://localhost:8280/work/', {})).toBe('http://localhost:8280/work')
    expect(publicBase(undefined, { host: 'api.jiraia.dev' })).toBe('https://api.jiraia.dev')
    expect(mcpResource('https://api.jiraia.dev')).toBe('https://api.jiraia.dev/v1/mcp')
  })

  it('send consent to the panel and require S256', () => {
    expect(authorizationServerMetadata('https://api', 'https://web/')).toMatchObject({
      authorization_endpoint: 'https://web/oauth/autorizar',
      token_endpoint: 'https://api/oauth/token',
      code_challenge_methods_supported: ['S256']
    })
    expect(mcpChallenge('https://api')).toContain(
      'resource_metadata="https://api/.well-known/oauth-protected-resource"'
    )
  })
})

describe('registration', () => {
  it('takes https and loopback redirects, nothing else', () => {
    const accept = (uri: string) => registerClientSchema.safeParse({ redirect_uris: [uri] }).success
    expect(accept('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(accept('http://localhost:33418/callback')).toBe(true)
    expect(accept('http://127.0.0.1:9/cb')).toBe(true)
    expect(accept('http://evil.example/cb')).toBe(false)
    expect(accept('https://app.example/cb#x')).toBe(false)
  })
})
