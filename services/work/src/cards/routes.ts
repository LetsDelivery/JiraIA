import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'
import { auditEventViewSchema } from '../audit/audit.js'

import { spacePathSchema } from '../spaces/schemas.js'
import type { CardService } from './card.service.js'
import {
  cardKeyPathSchema,
  cardListQuerySchema,
  cardListSchema,
  cardPathSchema,
  cardViewSchema,
  createCardSchema,
  createStateSchema,
  deleteStateQuerySchema,
  moveCardSchema,
  orderStatesSchema,
  rankInBacklogSchema,
  statePathSchema,
  transferCardSchema,
  updateCardSchema,
  updateStateSchema,
  workflowViewSchema
} from './schemas.js'
import type { WorkflowService } from './workflow.service.js'

export const workflowRoutes = (workflows: WorkflowService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/workflow',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await workflows.get(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/states',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createStateSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await workflows.addState(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: '/spaces/{spaceId}/states/order',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: orderStatesSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await workflows.orderStates(caller, path.spaceId, body.stateIds)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/spaces/{spaceId}/states/{stateId}',
    requires: 'authenticated',
    schemas: { path: statePathSchema, body: updateStateSchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await workflows.updateState(caller, path.spaceId, path.stateId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/states/{stateId}',
    requires: 'authenticated',
    schemas: { path: statePathSchema, query: deleteStateQuerySchema },
    responds: workflowViewSchema,
    handler: async ({ caller, path, query }) => ({
      statusCode: 200,
      body: await workflows.deleteState(caller, path.spaceId, path.stateId, query.moveTo)
    })
  })
]

export const cardRoutes = (cards: CardService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/cards',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, query: cardListQuerySchema },
    responds: cardListSchema,
    handler: async ({ caller, path, query }) => ({
      statusCode: 200,
      body: await cards.list(caller, path.spaceId, query.sprint)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/cards',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createCardSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await cards.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await cards.read(caller, path.cardId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/cards/{cardId}',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: updateCardSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await cards.update(caller, path.cardId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/by-key/{key}',
    requires: 'authenticated',
    schemas: { path: cardKeyPathSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await cards.readByKey(caller, path.key) })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/backlog',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: rankInBacklogSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await cards.rankInBacklog(caller, path.cardId, body.index)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/transfer',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: transferCardSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await cards.transfer(caller, path.cardId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/move',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: moveCardSchema },
    responds: cardViewSchema,
    handler: async ({ caller, path, body }) => ({ statusCode: 200, body: await cards.move(caller, path.cardId, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/history',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: z.object({ items: z.array(auditEventViewSchema) }),
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await cards.history(caller, path.cardId) })
  })
]
