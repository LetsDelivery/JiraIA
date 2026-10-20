import { defineRoute, type Route } from '@jiraia/http'

import { spacePathSchema } from '../spaces/schemas.js'
import type { AutomationService } from './automation.service.js'
import {
  automationInputSchema,
  automationListSchema,
  automationPathSchema,
  automationViewSchema,
  runListSchema
} from './schemas.js'

export const automationRoutes = (automations: AutomationService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/automations',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: automationListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await automations.list(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/automations',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: automationInputSchema },
    responds: automationViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await automations.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: '/automations/{automationId}',
    requires: 'authenticated',
    schemas: { path: automationPathSchema, body: automationInputSchema },
    responds: automationViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await automations.update(caller, path.automationId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/automations/{automationId}',
    requires: 'authenticated',
    schemas: { path: automationPathSchema },
    responds: automationListSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await automations.remove(caller, path.automationId)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/automations/{automationId}/runs',
    requires: 'authenticated',
    schemas: { path: automationPathSchema },
    responds: runListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await automations.runs(caller, path.automationId) })
  })
]
