import { defineRoute, type Route } from '@jiraia/http'

import { spacePathSchema } from '../spaces/schemas.js'
import {
  createTypeSchema,
  deleteTypeQuerySchema,
  orderTypesSchema,
  typePathSchema,
  updateTypeSchema
} from './card-type.schemas.js'
import type { CardTypeService } from './card-type.service.js'
import { workflowViewSchema } from './schemas.js'

/** A space's card types, from its settings (ADR-0031); each answers the workflow as it is now. */
export const cardTypeRoutes = (types: CardTypeService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/types',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createTypeSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, body }) => ({ statusCode: 201, body: await types.add(caller, path.spaceId, body) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/spaces/{spaceId}/types/order',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: orderTypesSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await types.order(caller, path.spaceId, body.typeIds)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/spaces/{spaceId}/types/{typeId}',
    requires: 'authenticated',
    schemas: { path: typePathSchema, body: updateTypeSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await types.update(caller, path.spaceId, path.typeId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/types/{typeId}',
    requires: 'authenticated',
    schemas: { path: typePathSchema, query: deleteTypeQuerySchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, query }) => ({
      statusCode: 200,
      body: await types.remove(caller, path.spaceId, path.typeId, query.moveTo)
    })
  })
]
