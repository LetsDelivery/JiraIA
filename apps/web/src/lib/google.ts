/**
 * Google Identity Services, behind the little this app uses of it (ADR-0005).
 *
 * The script is Google's own (`accounts.google.com/gsi/client`, loaded by index.html), not an npm
 * package: it answers with an **ID token** — a JWT Google signs — which the API Gateway authorizer
 * verifies and the API reads. There is no client secret and no session of ours.
 */
type CredentialResponse = { credential: string }

type GoogleIdentity = {
  initialize: (options: {
    client_id: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
    hd?: string
    ux_mode?: 'popup' | 'redirect'
  }) => void
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void
  prompt: () => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } }
  }
}

export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined
export const ALLOWED_DOMAIN: string = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN ?? 'uselets.com'

/** Waits for the script index.html loads `async`; it is usually there before the screen is. */
export const googleIdentity = async (): Promise<GoogleIdentity> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const identity = window.google?.accounts.id
    if (identity) {
      return identity
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Google Identity Services did not load')
}

/** What the screen needs from an ID token. Its signature is the API's to check, not the browser's. */
export const readIdToken = (token: string): { email: string; expiresAt: number } => {
  const payload = token.split('.')[1] ?? ''
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  const claims = JSON.parse(json) as { email?: string; exp?: number }

  return { email: (claims.email ?? '').toLowerCase(), expiresAt: (claims.exp ?? 0) * 1000 }
}

/** Stops One Tap signing the same account straight back in after "Sair". */
export const forgetGoogleSelection = (): void => {
  window.google?.accounts.id.disableAutoSelect()
}
