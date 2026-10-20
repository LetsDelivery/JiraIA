import { defineRoute, type Route } from '@jiraia/http'

import { spacePathSchema } from '../spaces/schemas.js'
import {
  deliveryListSchema,
  deliveryPathSchema,
  deliveryViewSchema,
  webhookInputSchema,
  webhookListSchema,
  webhookPathSchema,
  webhookViewSchema,
  webhookWithSecretSchema
} from './schemas.js'
import type { WebhookService } from './webhook.service.js'

export const webhookRoutes = (webhooks: WebhookService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/webhooks',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: webhookListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await webhooks.list(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/webhooks',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: webhookInputSchema },
    responds: webhookWithSecretSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await webhooks.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: '/webhooks/{webhookId}',
    requires: 'authenticated',
    schemas: { path: webhookPathSchema, body: webhookInputSchema },
    responds: webhookViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await webhooks.update(caller, path.webhookId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/webhooks/{webhookId}',
    requires: 'authenticated',
    schemas: { path: webhookPathSchema },
    responds: webhookListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await webhooks.remove(caller, path.webhookId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/webhooks/{webhookId}/secret',
    requires: 'authenticated',
    schemas: { path: webhookPathSchema },
    responds: webhookWithSecretSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await webhooks.rotate(caller, path.webhookId) })
  }),
  defineRoute({
    method: 'GET',
    path: '/webhooks/{webhookId}/deliveries',
    requires: 'authenticated',
    schemas: { path: webhookPathSchema },
    responds: deliveryListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await webhooks.deliveries(caller, path.webhookId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/webhooks/{webhookId}/deliveries/{deliveryId}/retry',
    requires: 'authenticated',
    schemas: { path: deliveryPathSchema },
    responds: deliveryViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await webhooks.redeliver(caller, path.webhookId, path.deliveryId)
    })
  })
]
