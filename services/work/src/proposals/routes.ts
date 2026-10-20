import { defineRoute, type Route } from '@jiraia/http'

import { cardPathSchema } from '../cards/schemas.js'
import { spacePathSchema } from '../spaces/schemas.js'
import type { ProposalService } from './proposal.service.js'
import {
  approveProposalSchema,
  createProposalSchema,
  listProposalsQuerySchema,
  pendingCountSchema,
  proposalListSchema,
  proposalPathSchema,
  proposalPolicySchema,
  proposalViewSchema,
  rejectProposalSchema
} from './schemas.js'

const readRoutes = (proposals: ProposalService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/proposals',
    requires: 'authenticated',
    schemas: { query: listProposalsQuerySchema },
    responds: proposalListSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await proposals.list(caller, query) })
  }),
  defineRoute({
    method: 'GET',
    path: '/proposals/pending-count',
    requires: 'authenticated',
    schemas: {},
    responds: pendingCountSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await proposals.pendingCount(caller) })
  }),
  defineRoute({
    method: 'GET',
    path: '/proposals/{proposalId}',
    requires: 'authenticated',
    schemas: { path: proposalPathSchema },
    responds: proposalViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await proposals.read(caller, path.proposalId) })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/proposals',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: proposalListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await proposals.forCard(caller, path.cardId) })
  })
]

const decisionRoutes = (proposals: ProposalService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/proposals/{proposalId}/approve',
    requires: 'authenticated',
    schemas: { path: proposalPathSchema, body: approveProposalSchema },
    responds: proposalViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await proposals.approve(caller, path.proposalId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/proposals/{proposalId}/reject',
    requires: 'authenticated',
    schemas: { path: proposalPathSchema, body: rejectProposalSchema },
    responds: proposalViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await proposals.reject(caller, path.proposalId, body.note)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/proposals/{proposalId}/withdraw',
    requires: 'authenticated',
    schemas: { path: proposalPathSchema },
    responds: proposalViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await proposals.withdraw(caller, path.proposalId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/proposals/{proposalId}/revert',
    requires: 'authenticated',
    schemas: { path: proposalPathSchema },
    responds: proposalViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await proposals.revert(caller, path.proposalId) })
  })
]

const spaceRoutes = (proposals: ProposalService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/proposals',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: createProposalSchema },
    responds: proposalViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await proposals.propose(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/proposal-policy',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: proposalPolicySchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await proposals.policy(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/spaces/{spaceId}/proposal-policy',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: proposalPolicySchema },
    responds: proposalPolicySchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await proposals.setPolicy(caller, path.spaceId, body)
    })
  })
]

/** Proposals (escopo-mvp 6.2, ADR-0019). */
export const proposalRoutes = (proposals: ProposalService): Route[] => [
  ...readRoutes(proposals),
  ...decisionRoutes(proposals),
  ...spaceRoutes(proposals)
]
