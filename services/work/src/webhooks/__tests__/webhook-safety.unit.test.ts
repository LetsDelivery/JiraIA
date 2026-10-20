import { describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'

import { newWebhookSecret, secretHint, signature } from '../signature.js'
import { assertPublicHttps } from '../url-safety.js'

describe('the webhook signature', () => {
  it('is HMAC-SHA256 of timestamp and body, as a receiver recomputes it', () => {
    const secret = newWebhookSecret()
    const expected = createHmac('sha256', secret).update('1760702400.{"a":1}').digest('hex')
    expect(signature(secret, 1760702400, '{"a":1}')).toBe(`t=1760702400,v1=${expected}`)
    expect(signature(secret, 1760702401, '{"a":1}')).not.toBe(signature(secret, 1760702400, '{"a":1}'))
  })

  it('shows only a hint of the secret', () => {
    expect(secretHint('whsec_abcdefgh1234')).toBe('whsec_…1234')
  })
})

describe('webhook addresses', () => {
  it('accept public https', () => {
    expect(() => assertPublicHttps('https://hooks.zapier.com/abc')).not.toThrow()
    expect(() => assertPublicHttps('https://erp.counterparty.test/jiraia')).not.toThrow()
  })

  it('refuse plain http, credentials, internal names and private or IPv6 addresses', () => {
    for (const url of [
      'http://example.com/x',
      'https://user:pass@example.com/',
      'https://localhost/x',
      'https://db.internal/',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/',
      'https://192.168.1.10/',
      'https://172.20.0.1/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'not a url'
    ]) {
      expect(() => assertPublicHttps(url)).toThrow()
    }
  })
})
