import { defineRoute, type Route } from '@jiraia/http'

import {
  createProfileSchema,
  createSystemSchema,
  profilePathSchema,
  staffPathSchema,
  systemListSchema,
  systemPathSchema,
  systemViewSchema,
  updateProfileSchema,
  updateSystemSchema
} from './catalog.schemas.js'
import type { CatalogService } from './catalog.service.js'
import {
  completionSchema,
  createRequestSchema,
  decisionSchema,
  entitlementListSchema,
  listEntitlementsQuerySchema,
  listRequestsQuerySchema,
  requestListSchema,
  requestPathSchema,
  requestViewSchema
} from './request.schemas.js'
import type { EntitlementRequestService } from './request.service.js'

/** Access governance (ADR-0024): the catalog of LET’S systems and their profiles. */
export const catalogRoutes = (catalog: CatalogService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/access/systems',
    requires: 'authenticated',
    schemas: {},
    responds: systemListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await catalog.list(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/systems',
    requires: 'authenticated',
    schemas: { body: createSystemSchema },
    responds: systemViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await catalog.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/access/systems/{systemId}',
    requires: 'authenticated',
    schemas: { path: systemPathSchema },
    responds: systemViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await catalog.read(caller, path.systemId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/access/systems/{systemId}',
    requires: 'authenticated',
    schemas: { path: systemPathSchema, body: updateSystemSchema },
    responds: systemViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await catalog.update(caller, path.systemId, body)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: '/access/systems/{systemId}/staff/{duty}/{memberId}',
    requires: 'authenticated',
    schemas: { path: staffPathSchema },
    responds: systemViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await catalog.putStaff(caller, path.systemId, path.duty, path.memberId)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/access/systems/{systemId}/staff/{duty}/{memberId}',
    requires: 'authenticated',
    schemas: { path: staffPathSchema },
    responds: systemViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await catalog.removeStaff(caller, path.systemId, path.duty, path.memberId)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/systems/{systemId}/profiles',
    requires: 'authenticated',
    schemas: { path: systemPathSchema, body: createProfileSchema },
    responds: systemViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await catalog.createProfile(caller, path.systemId, body)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/access/profiles/{profileId}',
    requires: 'authenticated',
    schemas: { path: profilePathSchema, body: updateProfileSchema },
    responds: systemViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await catalog.updateProfile(caller, path.profileId, body)
    })
  })
]

/** Access governance (ADR-0024): requests to grant or remove a profile, and who holds what. */
export const entitlementRoutes = (requests: EntitlementRequestService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/access/entitlement-requests',
    requires: 'authenticated',
    schemas: { query: listRequestsQuerySchema },
    responds: requestListSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await requests.list(caller, query) })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/entitlement-requests',
    requires: 'authenticated',
    schemas: { body: createRequestSchema },
    responds: requestViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await requests.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/access/entitlement-requests/{requestId}',
    requires: 'authenticated',
    schemas: { path: requestPathSchema },
    responds: requestViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await requests.read(caller, path.requestId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/entitlement-requests/{requestId}/decision',
    requires: 'authenticated',
    schemas: { path: requestPathSchema, body: decisionSchema },
    responds: requestViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await requests.decide(caller, path.requestId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/entitlement-requests/{requestId}/completion',
    requires: 'authenticated',
    schemas: { path: requestPathSchema, body: completionSchema },
    responds: requestViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await requests.complete(caller, path.requestId, body.evidence)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/entitlement-requests/{requestId}/cancellation',
    requires: 'authenticated',
    schemas: { path: requestPathSchema },
    responds: requestViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await requests.cancel(caller, path.requestId) })
  }),
  defineRoute({
    method: 'GET',
    path: '/access/entitlements',
    requires: 'authenticated',
    schemas: { query: listEntitlementsQuerySchema },
    responds: entitlementListSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await requests.entitlements(caller, query) })
  })
]
