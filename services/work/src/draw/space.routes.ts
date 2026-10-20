import { defineRoute, type Route } from '@jiraia/http'
import { draftRequestSchema, draftViewSchema } from './draft.js'
import type { DraftService } from './draft.service.js'
import {
  createDrawSpaceSchema,
  drawMarkPathSchema,
  drawSpaceListSchema,
  drawSpacePathSchema,
  drawSpaceViewSchema,
  updateDrawSpaceSchema
} from './draw-space.schemas.js'
import type { DrawSpaceService } from './draw-space.service.js'

/** LET’S Draw AI's spaces (ADR-0011): list, create, change, delete, star and follow. */
export const drawSpaceRoutes = (spaces: DrawSpaceService, drafts: DraftService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/draw/spaces/{spaceId}/drafts',
    requires: 'authenticated',
    schemas: { path: drawSpacePathSchema, body: draftRequestSchema },
    responds: draftViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await drafts.draft(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/spaces',
    requires: 'authenticated',
    schemas: {},
    responds: drawSpaceListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await spaces.list(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/spaces',
    requires: 'authenticated',
    schemas: { body: createDrawSpaceSchema },
    responds: drawSpaceViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await spaces.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/spaces/{spaceId}',
    requires: 'authenticated',
    schemas: { path: drawSpacePathSchema },
    responds: drawSpaceViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await spaces.read(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/draw/spaces/{spaceId}',
    requires: 'authenticated',
    schemas: { path: drawSpacePathSchema, body: updateDrawSpaceSchema },
    responds: drawSpaceViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await spaces.update(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/draw/spaces/{spaceId}',
    requires: 'authenticated',
    schemas: { path: drawSpacePathSchema },
    responds: drawSpaceListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await spaces.remove(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/draw/spaces/{spaceId}/marks/{mark}',
    requires: 'authenticated',
    schemas: { path: drawMarkPathSchema },
    responds: drawSpaceViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await spaces.mark(caller, path.spaceId, path.mark, true)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/draw/spaces/{spaceId}/marks/{mark}',
    requires: 'authenticated',
    schemas: { path: drawMarkPathSchema },
    responds: drawSpaceViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await spaces.mark(caller, path.spaceId, path.mark, false)
    })
  })
]
