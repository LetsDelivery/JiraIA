import { defineRoute, healthSchema, type Route } from '@jiraia/http'
import { z } from 'zod'

import { auditEventViewSchema } from './audit/audit.js'
import { uploadViewSchema } from './cards/attachment.schemas.js'
import type { AvatarService } from './members/avatar.service.js'
import type { MemberService } from './members/member.service.js'
import {
  avatarFileSchema,
  avatarPathSchema,
  inviteMemberSchema,
  memberListSchema,
  memberPathSchema,
  memberViewSchema,
  updateProfileSchema
} from './members/schemas.js'
import type { PersonalService } from './personal/personal.service.js'
import { mySpacesSchema } from './personal/schemas.js'
import {
  createSpaceSchema,
  listSpacesQuerySchema,
  roleHolderListSchema,
  roleHolderSchema,
  setRoleSchema,
  spaceListSchema,
  spaceMemberPathSchema,
  spacePathSchema,
  spaceViewSchema,
  updateSpaceSchema
} from './spaces/schemas.js'
import type { SpaceService } from './spaces/space.service.js'

type Services = { members: MemberService; avatars: AvatarService; spaces: SpaceService; personal: PersonalService }

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime().optional()
})

/** A person's photo (ADR-0039): announced, sent straight to storage, then confirmed; or taken off. */
const avatarRoutes = ({ avatars }: Services): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/me/avatar',
    requires: 'authenticated',
    schemas: { body: avatarFileSchema },
    responds: uploadViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await avatars.start(caller, body) })
  }),
  defineRoute({
    method: 'POST',
    path: '/me/avatar/{avatarId}/complete',
    requires: 'authenticated',
    schemas: { path: avatarPathSchema, body: avatarFileSchema },
    responds: memberViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await avatars.complete(caller, path.avatarId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/me/avatar',
    requires: 'authenticated',
    schemas: {},
    responds: memberViewSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await avatars.remove(caller) })
  })
]

const memberRoutes = ({ members }: Services): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/me',
    requires: 'authenticated',
    schemas: {},
    responds: memberViewSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await members.me(caller) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/me',
    requires: 'authenticated',
    schemas: { body: updateProfileSchema },
    responds: memberViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 200, body: await members.updateMe(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/members',
    requires: 'authenticated',
    schemas: {},
    responds: memberListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await members.list(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/members',
    requires: 'authenticated',
    schemas: { body: inviteMemberSchema },
    responds: memberViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await members.invite(caller, body) })
  }),
  defineRoute({
    method: 'POST',
    path: '/members/{memberId}/org-admin',
    requires: 'authenticated',
    schemas: { path: memberPathSchema, body: z.object({ isOrgAdmin: z.boolean() }) },
    responds: memberViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await members.setOrgAdmin(caller, path.memberId, body.isOrgAdmin)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/members/{memberId}/space-manager',
    requires: 'authenticated',
    schemas: { path: memberPathSchema, body: z.object({ isSpaceManager: z.boolean() }) },
    responds: memberViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await members.setSpaceManager(caller, path.memberId, body.isSpaceManager)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/members/{memberId}/access-auditor',
    requires: 'authenticated',
    schemas: { path: memberPathSchema, body: z.object({ isAccessAuditor: z.boolean() }) },
    responds: memberViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await members.setAccessAuditor(caller, path.memberId, body.isAccessAuditor)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/members/{memberId}/deactivate',
    requires: 'authenticated',
    schemas: { path: memberPathSchema },
    responds: memberViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await members.deactivate(caller, path.memberId) })
  })
]

const spaceRoutes = ({ spaces }: Services): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces',
    requires: 'authenticated',
    schemas: { query: listSpacesQuerySchema },
    responds: spaceListSchema,
    handler: async ({ caller, query }) => ({
      statusCode: 200,
      body: await spaces.list(caller, query.archived === 'true')
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces',
    requires: 'authenticated',
    schemas: { body: createSpaceSchema },
    responds: spaceViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await spaces.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: spaceViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await spaces.read(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/spaces/{spaceId}',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, body: updateSpaceSchema },
    responds: spaceViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await spaces.update(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/archive',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: spaceViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await spaces.setArchived(caller, path.spaceId, true)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/spaces/{spaceId}/unarchive',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: spaceViewSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await spaces.setArchived(caller, path.spaceId, false)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/history',
    requires: 'authenticated',
    schemas: { path: spacePathSchema, query: historyQuerySchema },
    responds: z.object({ items: z.array(auditEventViewSchema) }),
    handler: async ({ caller, path, query }) => ({
      statusCode: 200,
      body: await spaces.history(caller, path.spaceId, query.limit, query.before ? new Date(query.before) : undefined)
    })
  })
]

const spaceRoleRoutes = ({ spaces }: Services): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/spaces/{spaceId}/members',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: roleHolderListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await spaces.listRoles(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/spaces/{spaceId}/members/{memberId}',
    requires: 'authenticated',
    schemas: { path: spaceMemberPathSchema, body: setRoleSchema },
    responds: roleHolderSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await spaces.setRole(caller, path.spaceId, path.memberId, body.role)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/members/{memberId}',
    requires: 'authenticated',
    schemas: { path: spaceMemberPathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await spaces.removeRole(caller, path.spaceId, path.memberId)
      return { statusCode: 204 }
    }
  })
]

const personalRoutes = ({ personal }: Services): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/me/spaces',
    requires: 'authenticated',
    schemas: {},
    responds: mySpacesSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await personal.mySpaces(caller) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/spaces/{spaceId}/star',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await personal.star(caller, path.spaceId, true)
      return { statusCode: 204 }
    }
  }),
  defineRoute({
    method: 'DELETE',
    path: '/spaces/{spaceId}/star',
    requires: 'authenticated',
    schemas: { path: spacePathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await personal.star(caller, path.spaceId, false)
      return { statusCode: 204 }
    }
  })
]

const healthRoute = defineRoute({
  method: 'GET',
  path: '/health',
  requires: 'public',
  schemas: {},
  responds: healthSchema,
  handler: async () => ({ statusCode: 200, body: { service: 'work', status: 'ok' } })
})

export const workRoutes = (services: Services): Route[] => [
  healthRoute as Route,
  ...memberRoutes(services),
  ...avatarRoutes(services),
  ...spaceRoutes(services),
  ...spaceRoleRoutes(services),
  ...personalRoutes(services)
]
