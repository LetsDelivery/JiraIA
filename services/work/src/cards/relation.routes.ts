import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'

import { spacePathSchema } from '../spaces/schemas.js'
import {
  createFieldSchema,
  fieldListSchema,
  fieldPathSchema,
  fieldViewSchema,
  updateFieldSchema
} from './field.schemas.js'
import type { FieldService } from './field.service.js'
import { createLinkSchema, linkPathSchema, relationsViewSchema } from './link.schemas.js'
import type { LinkService } from './link.service.js'
import { cardPathSchema } from './schemas.js'

/** Parent, children and typed links of a card (2.6, 2.7). */
export const linkRoutes = (links: LinkService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/relations',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: relationsViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await links.relations(caller, path.cardId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/links',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: createLinkSchema },
    responds: relationsViewSchema,
    handler: async ({ caller, path, body }) => ({ statusCode: 201, body: await links.link(caller, path.cardId, body) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/cards/{cardId}/links/{linkId}',
    requires: 'authenticated',
    schemas: { path: linkPathSchema },
    responds: relationsViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await links.unlink(caller, path.cardId, path.linkId)
    })
  })
]

/** A space's custom fields (2.5), configured by its admins. */
export const fieldRoutes = (fields: FieldService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/fields',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: fieldListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await fields.list(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/fields',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createFieldSchema },
    responds: fieldViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await fields.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/spaces/{spaceId}/fields/{fieldId}',
    requires: 'authenticated',
    schemas: { path: fieldPathSchema, body: updateFieldSchema },
    responds: fieldViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await fields.update(caller, path.spaceId, path.fieldId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/fields/{fieldId}',
    requires: 'authenticated',
    schemas: { path: fieldPathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await fields.delete(caller, path.spaceId, path.fieldId)
      return { statusCode: 204 }
    }
  })
]
