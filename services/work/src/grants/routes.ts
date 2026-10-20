import { defineRoute, type Route } from '@jiraia/http'

import type { Product } from '../access.js'
import {
  accessPathSchema,
  accessViewSchema,
  grantGroupPathSchema,
  grantPersonPathSchema,
  grantRoleSchema,
  grantSpacePathSchema,
  grantsViewSchema
} from './grant.schemas.js'
import type { GrantService } from './grant.service.js'

const PREFIX: Record<Product, string> = { jiraia: '/spaces', draw: '/draw/spaces' }

/** Groups' roles and the explanation of access, on the spaces of one product (ADR-0012). */
const _shared = (grants: GrantService, product: Product): Route[] => [
  defineRoute({
    method: 'GET',
    path: `${PREFIX[product]}/{spaceId}/grants`,
    requires: 'authenticated',
    schemas: { path: grantSpacePathSchema },
    responds: grantsViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await grants.list(caller, product, path.spaceId) })
  }),
  defineRoute({
    method: 'GET',
    path: `${PREFIX[product]}/{spaceId}/access/{memberId}`,
    requires: 'authenticated',
    schemas: { path: accessPathSchema },
    responds: accessViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await grants.explain(caller, product, path.spaceId, path.memberId)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: `${PREFIX[product]}/{spaceId}/groups/{groupId}`,
    requires: 'authenticated',
    schemas: { path: grantGroupPathSchema, body: grantRoleSchema },
    responds: grantsViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await grants.putGroup(caller, product, path.spaceId, path.groupId, body.role)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: `${PREFIX[product]}/{spaceId}/groups/{groupId}`,
    requires: 'authenticated',
    schemas: { path: grantGroupPathSchema },
    responds: grantsViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await grants.removeGroup(caller, product, path.spaceId, path.groupId)
    })
  })
]

/** People's roles on a Let’s Draw AI space; JiraIA's keep their routes under `/spaces/{id}/members`. */
const _drawPeople = (grants: GrantService): Route[] => [
  defineRoute({
    method: 'PUT',
    path: '/draw/spaces/{spaceId}/members/{memberId}',
    requires: 'authenticated',
    schemas: { path: grantPersonPathSchema, body: grantRoleSchema },
    responds: grantsViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await grants.putPerson(caller, 'draw', path.spaceId, path.memberId, body.role)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/draw/spaces/{spaceId}/members/{memberId}',
    requires: 'authenticated',
    schemas: { path: grantPersonPathSchema },
    responds: grantsViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await grants.removePerson(caller, 'draw', path.spaceId, path.memberId)
    })
  })
]

export const grantRoutes = (grants: GrantService): Route[] => [
  ..._shared(grants, 'jiraia'),
  ..._shared(grants, 'draw'),
  ..._drawPeople(grants)
]
