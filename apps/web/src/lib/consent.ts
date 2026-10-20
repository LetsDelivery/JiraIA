import type { Authorization } from '@/api/oauth'

/** The request an application sent the person here with, or the reason it cannot be shown. */
export type ConsentRequest = { ok: true; request: Omit<Authorization, 'allow'> } | { ok: false; reason: string }

/**
 * Reads the authorization request from the consent page's address (RFC 6749 §4.1.1, PKCE required).
 *
 * @example consentRequest(new URLSearchParams('response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256'))
 */
export const consentRequest = (params: URLSearchParams): ConsentRequest => {
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  if (!clientId || !redirectUri) {
    return { ok: false, reason: 'O aplicativo não disse quem é ou para onde voltar.' }
  }
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !codeChallenge) {
    return { ok: false, reason: 'O pedido do aplicativo não segue o padrão seguro de conexão (OAuth com PKCE).' }
  }
  const optional = (name: string) => params.get(name) ?? undefined
  const request = {
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: 'S256' as const,
    state: optional('state'),
    scope: optional('scope'),
    resource: optional('resource')
  }
  return {
    ok: true,
    request: Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as Omit<
      Authorization,
      'allow'
    >
  }
}
