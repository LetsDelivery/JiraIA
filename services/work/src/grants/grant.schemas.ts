import { roleSchema } from '@jiraia/authorization'
import { z } from 'zod'

export const productSchema = z.enum(['jiraia', 'draw'])

export const personGrantSchema = z.object({
  memberId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  role: roleSchema
})
export type PersonGrant = z.infer<typeof personGrantSchema>

export const groupGrantSchema = z.object({
  groupId: z.uuid(),
  name: z.string(),
  role: roleSchema,
  memberCount: z.number().int()
})
export type GroupGrant = z.infer<typeof groupGrantSchema>

/**
 * Who holds what on a space: the general access every member of LET’S has, then groups and people
 * (ADR-0012) — what "Pessoas e papéis" shows.
 */
export const grantsViewSchema = z.object({
  general: z.object({ scope: z.literal('organization'), role: z.literal('reader') }),
  groups: z.array(groupGrantSchema),
  people: z.array(personGrantSchema),
  /** Whether the caller may change these — the space's admins and organization admins. */
  canManage: z.boolean()
})
export type GrantsView = z.infer<typeof grantsViewSchema>

export const grantSpacePathSchema = z.object({ spaceId: z.uuid() })
export const grantGroupPathSchema = z.object({ spaceId: z.uuid(), groupId: z.uuid() })
export const grantPersonPathSchema = z.object({ spaceId: z.uuid(), memberId: z.uuid() })
/** `me` asks about the caller — what the panel needs to show or hide what changes the space. */
export const accessPathSchema = z.object({ spaceId: z.uuid(), memberId: z.union([z.uuid(), z.literal('me')]) })
export const grantRoleSchema = z.object({ role: roleSchema })

export const accessSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('organization_admin'), role: z.literal('admin') }),
  z.object({ source: z.literal('direct'), role: roleSchema }),
  z.object({ source: z.literal('group'), role: roleSchema, groupId: z.uuid(), groupName: z.string() }),
  z.object({ source: z.literal('organization'), role: z.literal('reader') })
])

/** Why someone has the access they have, source by source, and what it lets them do. */
export const accessViewSchema = z.object({
  memberId: z.uuid(),
  role: roleSchema.nullable(),
  canWrite: z.boolean(),
  canManage: z.boolean(),
  sources: z.array(accessSourceSchema)
})
export type AccessView = z.infer<typeof accessViewSchema>
