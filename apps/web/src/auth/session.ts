import { forgetGoogleSelection } from '@/lib/google'
import { persistedStore } from '@/lib/store'

/**
 * Who is signed in, and the Google ID token that proves it (ADR-0005).
 *
 * `email` is kept beside the token for the local harness, which authenticates by the `x-local-user`
 * header rather than by a token. Locally, without a Google client id, `token` is empty.
 */
export type Session = {
  email: string
  token: string
  /** Epoch millis, from the token's `exp`. Used to sign in again early, never to decide access. */
  expiresAt: number
}

export const session = persistedStore<Session | null>('jiraia.session.v2', null)

export const signIn = (value: Session): void => session.set(value)

export const signOut = (): void => {
  forgetGoogleSelection()
  session.set(null)
}
