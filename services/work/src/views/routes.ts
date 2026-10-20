import { defineRoute, type Route } from '@jiraia/http'

import { cardListSchema } from '../cards/schemas.js'
import {
  createViewSchema,
  updateViewSchema,
  viewListQuerySchema,
  viewListSchema,
  viewPathSchema,
  viewSchema
} from './view.schemas.js'
import type { ViewService } from './view.service.js'

/** Saved views (escopo-mvp 3.5): keep a filter, share it with a space, run it. */
export const viewRoutes = (views: ViewService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/views',
    requires: 'authenticated',
    schemas: { query: viewListQuerySchema },
    responds: viewListSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await views.list(caller, query.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/views',
    requires: 'authenticated',
    schemas: { body: createViewSchema },
    responds: viewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await views.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/views/{viewId}',
    requires: 'authenticated',
    schemas: { path: viewPathSchema },
    responds: viewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await views.read(caller, path.viewId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/views/{viewId}',
    requires: 'authenticated',
    schemas: { path: viewPathSchema, body: updateViewSchema },
    responds: viewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await views.update(caller, path.viewId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/views/{viewId}',
    requires: 'authenticated',
    schemas: { path: viewPathSchema },
    responds: viewListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await views.remove(caller, path.viewId) })
  }),
  defineRoute({
    method: 'GET',
    path: '/views/{viewId}/cards',
    requires: 'authenticated',
    schemas: { path: viewPathSchema },
    responds: cardListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await views.cards(caller, path.viewId) })
  })
]
