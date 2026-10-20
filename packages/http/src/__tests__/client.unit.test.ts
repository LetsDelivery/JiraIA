import { describe, expect, it } from 'bun:test'

import { redactHeaders } from '../client.js'

describe('redactHeaders', () => {
  it('masks credentials and signatures in any case, and keeps the rest', () => {
    expect(
      redactHeaders({ Authorization: 'Bearer x', 'x-jiraia-signature': 't=1,v1=a', 'Content-Type': 'application/json' })
    ).toEqual({ Authorization: '***', 'x-jiraia-signature': '***', 'Content-Type': 'application/json' })
  })
})
