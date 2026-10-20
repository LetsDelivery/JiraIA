import { defineRoute, type Route } from '@jiraia/http'

import {
  accessDecisionSchema,
  accessRequestListSchema,
  accessRequestPathSchema,
  accessRequestQuerySchema,
  accessRequestViewSchema,
  createAccessRequestSchema
} from './request.schemas.js'
import type { AccessRequestService } from './request.service.js'

/** Asking to edit a space, and its admins' answer (ADR-0012). */
export const accessRequestRoutes = (requests: AccessRequestService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/access-requests',
    requires: 'authenticated',
    schemas: { body: createAccessRequestSchema },
    responds: accessRequestViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await requests.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/access-requests',
    requires: 'authenticated',
    schemas: { query: accessRequestQuerySchema },
    responds: accessRequestListSchema,
    handler: async ({ caller, query }) => ({
      statusCode: 200,
      body: await requests.list(caller, query.product, query.spaceId)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/access-requests/{requestId}/decision',
    requires: 'authenticated',
    schemas: { path: accessRequestPathSchema, body: accessDecisionSchema },
    responds: accessRequestViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await requests.decide(caller, path.requestId, body)
    })
  })
]
