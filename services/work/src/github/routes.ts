import { defineRoute, type Route } from '@jiraia/http'

import { cardPathSchema } from '../cards/schemas.js'
import type { GitHubConnectService } from './github-connect.service.js'
import { completeGitHubSchema, devLinkListSchema, githubInstallSchema, githubStatusSchema } from './schemas.js'

/** The organization's GitHub (Etapa 9, ADR-0038): its state, connecting and disconnecting it, and a card's development. */
export const githubRoutes = (github: GitHubConnectService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/integrations/github',
    requires: 'authenticated',
    schemas: {},
    responds: githubStatusSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await github.status(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/integrations/github/install',
    requires: 'authenticated',
    schemas: {},
    responds: githubInstallSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await github.install(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/integrations/github/complete',
    requires: 'authenticated',
    schemas: { body: completeGitHubSchema },
    responds: githubStatusSchema,
    handler: async ({ caller, body }) => ({ statusCode: 200, body: await github.complete(caller, body) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/integrations/github',
    requires: 'authenticated',
    schemas: {},
    responds: githubStatusSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await github.disconnect(caller) })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/development',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: devLinkListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await github.development(caller, path.cardId) })
  })
]
