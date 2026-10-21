import { describe, expect, it } from 'vitest'

import { freshSession, session, signIn } from './session'

describe('freshSession', () => {
  it('sends the session as it is while its token is far from lapsing', async () => {
    const now = Date.now()
    signIn({ email: 'ana@uselets.com', token: 't1', expiresAt: now + 30 * 60 * 1000, refreshToken: 'r1' })
    expect((await freshSession(now))?.token).toBe('t1')
  })

  it('keeps a session with nothing to renew it by, as the local harness signs in', async () => {
    const now = Date.now()
    signIn({ email: 'ana@uselets.com', token: '', expiresAt: now - 1000 })
    expect(await freshSession(now)).toEqual(session.get())
  })

  it('has nothing to send when nobody is signed in', async () => {
    session.set(null)
    expect(await freshSession()).toBeNull()
  })
})
