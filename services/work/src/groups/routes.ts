import { defineRoute, type Route } from '@jiraia/http'

import {
  createGroupSchema,
  groupListSchema,
  groupMemberPathSchema,
  groupMembershipSchema,
  groupPathSchema,
  groupViewSchema,
  updateGroupSchema
} from './group.schemas.js'
import type { GroupService } from './group.service.js'

/** Groups (ADR-0012): who is in which area or team, so a role reaches all of them at once. */
export const groupRoutes = (groups: GroupService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/groups',
    requires: 'authenticated',
    schemas: {},
    responds: groupListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await groups.list(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/groups',
    requires: 'authenticated',
    schemas: { body: createGroupSchema },
    responds: groupViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await groups.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/groups/{groupId}',
    requires: 'authenticated',
    schemas: { path: groupPathSchema },
    responds: groupViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await groups.read(caller, path.groupId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/groups/{groupId}',
    requires: 'authenticated',
    schemas: { path: groupPathSchema, body: updateGroupSchema },
    responds: groupViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await groups.update(caller, path.groupId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/groups/{groupId}',
    requires: 'authenticated',
    schemas: { path: groupPathSchema },
    responds: groupListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await groups.remove(caller, path.groupId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/groups/{groupId}/members/{memberId}',
    requires: 'authenticated',
    schemas: { path: groupMemberPathSchema, body: groupMembershipSchema },
    responds: groupViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await groups.putMember(caller, path.groupId, path.memberId, body.isOwner)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/groups/{groupId}/members/{memberId}',
    requires: 'authenticated',
    schemas: { path: groupMemberPathSchema },
    responds: groupViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await groups.removeMember(caller, path.groupId, path.memberId)
    })
  })
]
