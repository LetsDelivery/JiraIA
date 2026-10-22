import { COGNITO, logoutUrl, refreshTokens, type Tokens } from '@/lib/cognito'
import { persistedStore } from '@/lib/store'

/**
 * Who is signed in, and the Cognito ID token that proves it (ADR-0026).
 *
 * `email` is kept beside the token for the local harness, which authenticates by the `x-local-user`
 * header rather than by a token. Locally, without a user pool, `token` is empty.
 */
export type Session = Tokens

/** v3: the session became Cognito's, with a refresh token; a v2 Google session is simply not read. */
export const session = persistedStore<Session | null>('jiraia.session.v3', null)

export const signIn = (value: Session): void => session.set(value)

export const signOut = (): void => session.set(null)

/** "Sair": this panel's session, and the pool's, so the next sign-in goes through Google again. */
export const signOutEverywhere = (): void => {
  const signedInByPool = Boolean(session.get()?.refreshToken)
  signOut()
  if (COGNITO && signedInByPool) {
    location.assign(logoutUrl(COGNITO))
  }
}

/** Renewed this long before it lapses, so a request in flight never carries an expired token. */
const EARLY_MS = 2 * 60 * 1000

let renewing: Promise<Session | null> | undefined

const _renew = async (current: Session): Promise<Session | null> => {
  if (!COGNITO || !current.refreshToken) {
    return current
  }
  try {
    const renewed = await refreshTokens(COGNITO, current.refreshToken)
    signIn(renewed)
    return renewed
  } catch {
    // The pool no longer takes the refresh token (revoked, or 30 days old): sign in again.
    signOut()
    return null
  }
}

/** The session to send now, renewed first when its ID token is about to lapse; one renewal at a time. */
export const freshSession = async (now = Date.now()): Promise<Session | null> => {
  const current = session.get()
  if (!current || current.expiresAt - EARLY_MS > now) {
    return current
  }
  renewing ??= _renew(current).finally(() => {
    renewing = undefined
  })
  return await renewing
}
