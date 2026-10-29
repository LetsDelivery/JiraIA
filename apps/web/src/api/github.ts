import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 9 (ADR-0038): the organization's GitHub — its state, installing the App — and a card's development. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type GitHubStatus = Json<'/work/integrations/github', 'get'>
export type DevLink = Json<'/work/cards/{cardId}/development', 'get'>['items'][number]

export const githubRead = {
  status: () => cached('github', () => unwrap(api.GET('/work/integrations/github'))),
  /** A card's branches and pull requests: never cached, GitHub changes them at any time. */
  development: (cardId: string) => unwrap(api.GET('/work/cards/{cardId}/development', { params: { path: { cardId } } }))
}

export const githubWrite = {
  /** Where the App's installation page is, for this admin; the browser goes there. */
  install: () => unwrap(api.POST('/work/integrations/github/install')),
  complete: async (installationId: string, state: string) => {
    const status = await unwrap(api.POST('/work/integrations/github/complete', { body: { installationId, state } }))
    invalidate('github')
    return status
  },
  /** The App an owner already installed on GitHub, connected without going there (ADR-0038). */
  connectInstalled: async () => {
    const status = await unwrap(api.POST('/work/integrations/github/connect-installed'))
    invalidate('github')
    return status
  },
  disconnect: async () => {
    const status = await unwrap(api.DELETE('/work/integrations/github'))
    invalidate('github')
    return status
  }
}
