import { defineRoute, type Route } from '@jiraia/http'

import { spacePathSchema } from '../spaces/schemas.js'
import { createLabelSchema, labelListSchema, labelPathSchema, updateLabelSchema } from './label.schemas.js'
import type { LabelService } from './label.service.js'

/** A space's labels, read by everyone who reads it and managed from its settings (ADR-0032). */
export const labelRoutes = (labels: LabelService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/labels',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: labelListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await labels.list(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/labels',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createLabelSchema },
    responds: labelListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await labels.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/spaces/{spaceId}/labels/{labelId}',
    requires: 'authenticated',
    schemas: { path: labelPathSchema, body: updateLabelSchema },
    responds: labelListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await labels.update(caller, path.spaceId, path.labelId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/labels/{labelId}',
    requires: 'authenticated',
    schemas: { path: labelPathSchema },
    responds: labelListSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await labels.remove(caller, path.spaceId, path.labelId)
    })
  })
]
