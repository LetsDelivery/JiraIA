import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'

import { auditEventViewSchema } from '../audit/audit.js'

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
import { type HolidayService, holidayListSchema, holidayPathSchema, putHolidaySchema } from './holidays.js'
import { type InventoryImport, importResultSchema, importSchema } from './inventory.js'
import { type AccessReport, reportQuerySchema, reportSchema } from './report.js'
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
import {
  decideItemSchema,
  listReviewsQuerySchema,
  openReviewSchema,
  reviewItemPathSchema,
  reviewListSchema,
  reviewPathSchema,
  reviewViewSchema
} from './review.schemas.js'
import type { ReviewService } from './review.service.js'

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
    method: 'GET',
    path: '/access/systems/{systemId}/history',
    requires: 'authenticated',
    schemas: { path: systemPathSchema },
    responds: z.object({ items: z.array(auditEventViewSchema) }),
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await catalog.history(caller, path.systemId) })
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

/** The business calendar the SLAs count on (ADR-0024): national holidays and the organization's own. */
export const holidayRoutes = (holidays: HolidayService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/access/holidays',
    requires: 'authenticated',
    schemas: {},
    responds: holidayListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await holidays.list(caller) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/access/holidays/{day}',
    requires: 'authenticated',
    schemas: { path: holidayPathSchema, body: putHolidaySchema },
    responds: holidayListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await holidays.put(caller, path.day, body.name)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/access/holidays/{day}',
    requires: 'authenticated',
    schemas: { path: holidayPathSchema },
    responds: holidayListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await holidays.remove(caller, path.day) })
  })
]

/** Periodic access reviews (ADR-0024): owners confirm or remove what their systems grant. */
export const reviewRoutes = (reviews: ReviewService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/access/reviews',
    requires: 'authenticated',
    schemas: { query: listReviewsQuerySchema },
    responds: reviewListSchema,
    handler: async ({ caller, query }) => ({
      statusCode: 200,
      body: await reviews.list(caller, query.open === undefined ? undefined : query.open === 'true')
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/systems/{systemId}/reviews',
    requires: 'authenticated',
    schemas: { path: systemPathSchema, body: openReviewSchema },
    responds: reviewViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await reviews.open(caller, path.systemId, body.privilege)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/access/reviews/{reviewId}',
    requires: 'authenticated',
    schemas: { path: reviewPathSchema },
    responds: reviewViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await reviews.read(caller, path.reviewId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/reviews/{reviewId}/items/{entitlementId}',
    requires: 'authenticated',
    schemas: { path: reviewItemPathSchema, body: decideItemSchema },
    responds: reviewViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await reviews.decide(caller, path.reviewId, path.entitlementId, body)
    })
  })
]

/** What an auditor needs (ADR-0024): the SLA report, and loading the access held before go-live. */
export const auditRoutes = (report: AccessReport, inventory: InventoryImport): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/access/report',
    requires: 'authenticated',
    schemas: { query: reportQuerySchema },
    responds: reportSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await report.read(caller, query.from, query.to) })
  }),
  defineRoute({
    method: 'POST',
    path: '/access/entitlements/import',
    requires: 'authenticated',
    schemas: { body: importSchema },
    responds: importResultSchema,
    handler: async ({ caller, body }) => ({ statusCode: 200, body: await inventory.run(caller, body.rows) })
  })
]
