import { describe, expect, it } from 'bun:test'

import { UnauthenticatedException } from '@jiraia/core'

import { callerFromClaims } from '../caller.js'

describe('callerFromClaims', () => {
  it('reads a Google ID token as the authorizer flattens it, lowercasing email and domain', () => {
    const caller = callerFromClaims({
      sub: '1098',
      email: 'Ana@USELETS.com',
      email_verified: 'true',
      hd: 'USELETS.com'
    })

    expect(caller).toEqual({
      subject: '1098',
      email: 'ana@uselets.com',
      emailVerified: true,
      hostedDomain: 'uselets.com'
    })
  })

  it('treats a missing or false email_verified as unverified', () => {
    expect(callerFromClaims({ sub: '1', email: 'a@uselets.com' }).emailVerified).toBe(false)
    expect(callerFromClaims({ sub: '1', email_verified: 'false' }).emailVerified).toBe(false)
  })

  it('leaves the domain absent for a consumer Google account', () => {
    expect(callerFromClaims({ sub: '1', email: 'a@gmail.com', email_verified: true }).hostedDomain).toBeUndefined()
  })

  it('reads the Workspace domain a Cognito ID token carries as custom:hd (ADR-0026)', () => {
    const caller = callerFromClaims({
      sub: '1b7e',
      email: 'ana@uselets.com',
      email_verified: true,
      'custom:hd': 'uselets.com'
    })

    expect(caller.hostedDomain).toBe('uselets.com')
  })

  it('refuses claims with no subject', () => {
    expect(() => callerFromClaims({ email: 'a@uselets.com' })).toThrow(UnauthenticatedException)
  })
})
