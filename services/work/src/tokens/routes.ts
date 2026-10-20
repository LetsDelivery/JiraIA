import { defineRoute, type Route } from '@jiraia/http'

import {
  createdTokenSchema,
  createServiceAccountSchema,
  createTokenSchema,
  serviceAccountListSchema,
  serviceAccountPathSchema,
  serviceAccountSchema,
  tokenListSchema,
  tokenPathSchema,
  tokenViewSchema
} from './schemas.js'
import type { TokenService } from './token.service.js'

export const tokenRoutes = (tokens: TokenService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/me/tokens',
    requires: 'authenticated',
    schemas: {},
    responds: tokenListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await tokens.mine(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/me/tokens',
    requires: 'authenticated',
    schemas: { body: createTokenSchema },
    responds: createdTokenSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await tokens.createMine(caller, body) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/api-tokens/{tokenId}',
    requires: 'authenticated',
    schemas: { path: tokenPathSchema },
    responds: tokenViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await tokens.revoke(caller, path.tokenId) })
  }),
  defineRoute({
    method: 'GET',
    path: '/service-accounts',
    requires: 'authenticated',
    schemas: {},
    responds: serviceAccountListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await tokens.serviceAccounts(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/service-accounts',
    requires: 'authenticated',
    schemas: { body: createServiceAccountSchema },
    responds: serviceAccountSchema,
    handler: async ({ caller, body }) => ({
      statusCode: 201,
      body: await tokens.createServiceAccount(caller, body.name)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/service-accounts/{memberId}/tokens',
    requires: 'authenticated',
    schemas: { path: serviceAccountPathSchema, body: createTokenSchema },
    responds: createdTokenSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await tokens.createServiceToken(caller, path.memberId, body)
    })
  })
]
