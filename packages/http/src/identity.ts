import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose'

import { type Caller, callerFromClaims } from './caller.js'

/**
 * The service's check of a sign-in token: the caller it proves, or nothing when it proves none.
 *
 * People sign in with Google through the stack's Cognito user pool (ADR-0026), which hands the panel
 * an **ID token** it signs. The API has one `ANY /{proxy+}` route and no authorizer (ADR-0025), so
 * the token is verified here: signature against the pool's published keys, issuer, audience (the
 * panel's app client) and expiry, and that it is an ID token rather than an access token. Whether
 * the account is of our Workspace domain is still the service's decision.
 */
export type IdentityVerifier = { verify(token: string): Promise<Caller | undefined> }

export type CognitoIdentityOptions = {
  /** `https://cognito-idp.<region>.amazonaws.com/<user pool id>`: the pool's own `iss`. */
  issuer: string
  /** The panel's app client id: a token minted for any other client is refused. */
  audience: string
  /** The pool's keys; the tests hand over their own. Fetched once and cached by `jose` otherwise. */
  keys?: JWTVerifyGetKey
}

/**
 * @example
 * const identity = cognitoIdentity({ issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Ab', audience: '4fk…' })
 * await identity.verify(idToken)   // { subject: '1b7…', email: 'ana@uselets.com', hostedDomain: 'uselets.com', … } or undefined
 */
export const cognitoIdentity = (options: CognitoIdentityOptions): IdentityVerifier => {
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${options.issuer}/.well-known/jwks.json`))

  return {
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['RS256']
        })
        // An access token of the same pool has no audience and no e-mail; only an ID token signs in.
        return payload.token_use === 'id' ? callerFromClaims(payload) : undefined
      } catch (error) {
        // A token that fails a check proves no one: a 401, not a 500. Anything else is ours.
        if (error instanceof errors.JOSEError) {
          return undefined
        }
        throw error
      }
    }
  }
}
