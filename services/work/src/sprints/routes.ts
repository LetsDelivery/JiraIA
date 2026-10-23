import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'

import { spacePathSchema } from '../spaces/schemas.js'
import {
  closeSprintSchema,
  createSprintSchema,
  sprintListQuerySchema,
  sprintListSchema,
  sprintPathSchema,
  sprintViewSchema,
  startSprintSchema,
  updateSprintSchema
} from './schemas.js'
import type { SprintService } from './sprint.service.js'

/** A space's sprints (escopo-mvp 3.11, ADR-0029). */
export const sprintRoutes = (sprints: SprintService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/sprints',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, query: sprintListQuerySchema },
    responds: sprintListSchema,
    handler: async ({ caller, path, query }) => ({
      statusCode: 200,
      body: await sprints.list(caller, path.spaceId, query.state)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/sprints',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createSprintSchema },
    responds: sprintViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await sprints.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/sprints/{sprintId}',
    requires: 'authenticated',
    schemas: { path: sprintPathSchema, body: updateSprintSchema },
    responds: sprintViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await sprints.update(caller, path.sprintId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/sprints/{sprintId}',
    requires: 'authenticated',
    schemas: { path: sprintPathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await sprints.remove(caller, path.sprintId)
      return { statusCode: 204 }
    }
  }),
  defineRoute({
    method: 'POST',
    path: '/sprints/{sprintId}/start',
    requires: 'authenticated',
    schemas: { path: sprintPathSchema, body: startSprintSchema },
    responds: sprintViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await sprints.start(caller, path.sprintId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/sprints/{sprintId}/close',
    requires: 'authenticated',
    schemas: { path: sprintPathSchema, body: closeSprintSchema },
    responds: sprintViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await sprints.close(caller, path.sprintId, body)
    })
  })
]
