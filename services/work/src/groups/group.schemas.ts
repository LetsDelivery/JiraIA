import { roleSchema } from '@jiraia/authorization'
import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { groups } from '../schema.js'

export type GroupRow = typeof groups.$inferSelect

const nameSchema = z.string().trim().min(1).max(80)

export const createGroupSchema = z.object({ name: nameSchema, description: z.string().trim().max(300).default('') })
export type CreateGroup = z.infer<typeof createGroupSchema>
export const updateGroupSchema = z
  .object({ name: nameSchema.optional(), description: z.string().trim().max(300).optional() })
  .refine((input) => input.name !== undefined || input.description !== undefined, {
    message: 'Send a name or a description'
  })
export type UpdateGroup = z.infer<typeof updateGroupSchema>

export const groupPathSchema = z.object({ groupId: z.uuid() })
export const groupMemberPathSchema = z.object({ groupId: z.uuid(), memberId: z.uuid() })
/** Adding a member, or changing whether they own the group — an owner adds and removes members. */
export const groupMembershipSchema = z.object({ isOwner: z.boolean().default(false) })

export const groupMemberViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  isOwner: z.boolean()
})
/** A role the group holds on a space, in either product — what "Grupos" shows a group can do. */
export const groupGrantViewSchema = z.object({
  product: z.enum(['jiraia', 'draw']),
  spaceId: z.uuid(),
  /** The space's key in JiraIA, its icon in Let’s Draw AI. */
  label: z.string(),
  name: z.string(),
  role: roleSchema
})
export type GroupGrantRow = Omit<z.infer<typeof groupGrantViewSchema>, 'role'> & { groupId: string; role: string }

export const groupViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  members: z.array(groupMemberViewSchema),
  access: z.array(groupGrantViewSchema),
  /** Whether the caller may change who is in it: an owner, or an organization admin. */
  canEdit: z.boolean(),
  /** Whether the caller may rename or delete it and name its owners: an organization admin. */
  canManage: z.boolean(),
  updatedAt: z.iso.datetime()
})
export type GroupView = z.infer<typeof groupViewSchema>
export const groupListSchema = z.object({ items: z.array(groupViewSchema) })

export type GroupMemberRow = { groupId: string; memberId: string; name: string; email: string | null; isOwner: boolean }

export const toGroupView = (
  row: GroupRow,
  members: readonly GroupMemberRow[],
  actor: { id: string; isOrgAdmin: boolean },
  grants: readonly GroupGrantRow[] = []
): GroupView => {
  const own = members.filter((each) => each.groupId === row.id)
  const owner = own.some((each) => each.memberId === actor.id && each.isOwner)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    members: own.map((each) => ({ id: each.memberId, name: each.name, email: each.email, isOwner: each.isOwner })),
    access: grants
      .filter((each) => each.groupId === row.id)
      .map(({ groupId: _, role, ...grant }) => ({ ...grant, role: roleSchema.parse(role) })),
    canEdit: actor.isOrgAdmin || owner,
    canManage: actor.isOrgAdmin,
    updatedAt: toIso(row.updatedAt)
  }
}
