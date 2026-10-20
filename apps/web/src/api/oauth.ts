import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 6c (ADR-0021): the consent page's reads and answer, and the person's connected applications. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type ConsentClient = Json<'/work/oauth/consent', 'get'>
export type Connection = Json<'/work/me/connections', 'get'>['items'][number]
export type Authorization = {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  state?: string
  scope?: string
  resource?: string
  allow: boolean
}

export const oauthRead = {
  consentClient: (clientId: string, redirectUri: string) =>
    unwrap(api.GET('/work/oauth/consent', { params: { query: { client_id: clientId, redirect_uri: redirectUri } } })),
  connections: () => cached('connections', () => unwrap(api.GET('/work/me/connections')))
}

export const oauthWrite = {
  authorize: (body: Authorization) => unwrap(api.POST('/work/oauth/authorizations', { body })),
  revoke: async (connectionId: string) => {
    await unwrap(api.DELETE('/work/me/connections/{connectionId}', { params: { path: { connectionId } } }))
    invalidate('connections')
  }
}
