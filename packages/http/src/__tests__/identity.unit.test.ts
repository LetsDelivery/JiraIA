import { describe, expect, it } from 'bun:test'

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

import { cognitoIdentity } from '../identity.js'

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_JiraIA'
const AUDIENCE = 'jiraia-panel-client'

/** A key pair standing in for the user pool's, and the public half published the way Cognito does. */
const pool = await generateKeyPair('RS256')
const stranger = await generateKeyPair('RS256')
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pool.publicKey)), kid: 'pool-1', alg: 'RS256' }] })
const identity = cognitoIdentity({ issuer: ISSUER, audience: AUDIENCE, keys })

const claims = {
  email: 'Ana@uselets.com',
  email_verified: true,
  'custom:hd': 'uselets.com',
  name: 'Ana',
  token_use: 'id'
}

type Minted = {
  key?: CryptoKey
  audience?: string
  issuer?: string
  expires?: string
  tokenUse?: string
}

const _mint = async (minted: Minted = {}): Promise<string> =>
  await new SignJWT({ ...claims, token_use: minted.tokenUse ?? 'id' })
    .setProtectedHeader({ alg: 'RS256', kid: 'pool-1' })
    .setSubject('1b7e-ana')
    .setIssuer(minted.issuer ?? ISSUER)
    .setAudience(minted.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(minted.expires ?? '1h')
    .sign(minted.key ?? pool.privateKey)

describe('cognitoIdentity', () => {
  it('proves the caller of an ID token the pool signed for the panel', async () => {
    expect(await identity.verify(await _mint())).toEqual({
      subject: '1b7e-ana',
      email: 'ana@uselets.com',
      emailVerified: true,
      hostedDomain: 'uselets.com',
      name: 'Ana'
    })
  })

  it('proves no one with an access token of the same pool', async () => {
    expect(await identity.verify(await _mint({ tokenUse: 'access' }))).toBeUndefined()
  })

  it('proves no one with a token minted for another client', async () => {
    expect(await identity.verify(await _mint({ audience: 'another-client' }))).toBeUndefined()
  })

  it('proves no one with a token another pool signed', async () => {
    const other = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other'
    expect(await identity.verify(await _mint({ issuer: other }))).toBeUndefined()
  })

  it('proves no one with a token signed by a key the pool never published', async () => {
    expect(await identity.verify(await _mint({ key: stranger.privateKey }))).toBeUndefined()
  })

  it('proves no one with an expired token', async () => {
    expect(await identity.verify(await _mint({ expires: '-1m' }))).toBeUndefined()
  })

  it('proves no one with something that is not a token', async () => {
    expect(await identity.verify('jia_not-a-jwt')).toBeUndefined()
  })
})
