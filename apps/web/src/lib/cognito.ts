/**
 * Signing in with Google through the stack's Cognito user pool (ADR-0026).
 *
 * The panel is a public client: no secret, an authorization code with PKCE. "Entrar com Google" goes
 * to the pool's hosted sign-in with `identity_provider=Google`, which sends the person straight to
 * Google and back to `/entrar` with a code; the code becomes an **ID token** the API verifies, and a
 * refresh token that renews it, so a session outlives the hour an ID token lasts.
 */

/** What the deploy writes into `config.js` for the account the panel is served from (ADR-0025). */
type RuntimeConfig = { cognitoDomain?: string; cognitoClientId?: string; allowedEmailDomains?: string[] }

export type Cognito = { domain: string; clientId: string }

/** One build serves every account, so the account's own settings win over the build's. */
const runtime: RuntimeConfig = (globalThis as { JIRAIA_CONFIG?: RuntimeConfig }).JIRAIA_CONFIG ?? {}

/** Absent locally, where the harness signs in by e-mail (`x-local-user`) and there is no pool. */
export const COGNITO: Cognito | undefined =
  runtime.cognitoDomain && runtime.cognitoClientId
    ? { domain: runtime.cognitoDomain, clientId: runtime.cognitoClientId }
    : undefined

/** LET'S Workspace domains, which the sign-in screen names; the API is what enforces them. */
export const ALLOWED_DOMAINS: readonly string[] = runtime.allowedEmailDomains?.length
  ? runtime.allowedEmailDomains
  : (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS ?? 'uselets.com,lets.delivery').split(',')

/**
 * The domains as the screen says them, in Portuguese.
 *
 * @example domainsSentence(['uselets.com', 'lets.delivery'])   // '@uselets.com ou @lets.delivery'
 */
export const domainsSentence = (domains: readonly string[]): string =>
  domains.map((domain) => `@${domain}`).join(' ou ')

/** Where the pool sends people back, and where they land after signing out: the sign-in screen. */
export const RETURN_PATH = '/entrar'

/** What a sign-in yields: the ID token the API reads, and what renews it. */
export type Tokens = { email: string; token: string; expiresAt: number; refreshToken?: string }

/** A PKCE pair (RFC 7636) and the `state` that ties the answer to this browser's request. */
export type Pkce = { verifier: string; challenge: string; state: string }

const PKCE_KEY = 'jiraia.pkce'

const _base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const _random = (size: number): string => _base64url(crypto.getRandomValues(new Uint8Array(size)))

export const createPkce = async (): Promise<Pkce> => {
  const verifier = _random(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: _base64url(new Uint8Array(digest)), state: _random(16) }
}

/**
 * @example authorizeUrl(cognito, 'https://x.cloudfront.net/entrar', pkce)   // 'https://….amazoncognito.com/oauth2/authorize?…'
 */
export const authorizeUrl = (cognito: Cognito, redirectUri: string, pkce: Pkce): string => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: cognito.clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    // Straight to Google: the pool's own sign-in page has nothing else to offer.
    identity_provider: 'Google',
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256'
  })
  return `${cognito.domain}/oauth2/authorize?${query}`
}

/** What the screen needs from an ID token. Its signature is the API's to check, not the browser's. */
export const readIdToken = (token: string): { email: string; expiresAt: number } => {
  const payload = token.split('.')[1] ?? ''
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  const claims = JSON.parse(json) as { email?: string; exp?: number }

  return { email: (claims.email ?? '').toLowerCase(), expiresAt: (claims.exp ?? 0) * 1000 }
}

type TokenAnswer = { id_token?: string; refresh_token?: string }

const _exchange = async (cognito: Cognito, form: Record<string, string>): Promise<Tokens> => {
  const response = await fetch(`${cognito.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cognito.clientId, ...form })
  })
  const answer = (await response.json().catch(() => ({}))) as TokenAnswer
  if (!response.ok || !answer.id_token) {
    throw new Error(`The sign-in token exchange answered ${response.status}`)
  }
  const { id_token: token, refresh_token: refreshToken } = answer
  return { ...readIdToken(token), token, ...(refreshToken ? { refreshToken } : {}) }
}

const _redirectUri = (): string => `${location.origin}${RETURN_PATH}`

/**
 * What the pool said when it sent the person back without a code — a provider it does not have, a
 * refusal at Google — or nothing when it did not.
 *
 * @example signInError('?error=invalid_request&error_description=Login+option+is+not+available')   // 'Login option is not available'
 */
export const signInError = (search: string): string | undefined => {
  const params = new URLSearchParams(search)
  const error = params.get('error')
  return error ? (params.get('error_description') ?? error) : undefined
}

/** Leaves for Google, keeping in this tab what proves the answer is to this request. */
export const startSignIn = async (cognito: Cognito): Promise<void> => {
  const pkce = await createPkce()
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: pkce.verifier, state: pkce.state }))
  location.assign(authorizeUrl(cognito, _redirectUri(), pkce))
}

/**
 * The tokens of a sign-in the pool just answered, when `search` carries its code; nothing otherwise.
 * A code whose `state` this tab did not ask for is refused.
 */
export const finishSignIn = async (cognito: Cognito, search: string): Promise<Tokens | undefined> => {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  if (!code) {
    return undefined
  }
  const stored = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? '{}') as { verifier?: string; state?: string }
  sessionStorage.removeItem(PKCE_KEY)
  if (!stored.verifier || stored.state !== params.get('state')) {
    throw new Error('The sign-in answer does not match a request from this tab')
  }
  const form = { grant_type: 'authorization_code', code, redirect_uri: _redirectUri(), code_verifier: stored.verifier }
  return await _exchange(cognito, form)
}

/** A new ID token for the same person; the pool keeps the refresh token as it was. */
export const refreshTokens = async (cognito: Cognito, refreshToken: string): Promise<Tokens> => ({
  ...(await _exchange(cognito, { grant_type: 'refresh_token', refresh_token: refreshToken })),
  refreshToken
})

/** Ends the pool's own session too, so the next "Entrar" asks Google again rather than reusing it. */
export const logoutUrl = (cognito: Cognito): string =>
  `${cognito.domain}/logout?${new URLSearchParams({ client_id: cognito.clientId, logout_uri: _redirectUri() })}`
