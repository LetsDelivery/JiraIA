import { roleSchema } from '@jiraia/authorization'
import { toIso } from '@jiraia/core'
import { z } from 'zod'

import { memberKindSchema } from '../members/schemas.js'
import type { spaces } from '../schema.js'

export type SpaceRow = typeof spaces.$inferSelect

/** The kinds of space the company runs today in Jira (inventory of 2026-10-15). */
export const spaceTypeValues = ['software', 'business', 'product_discovery', 'service_desk'] as const
export const spaceTypeSchema = z.enum(spaceTypeValues)
export type SpaceType = z.infer<typeof spaceTypeSchema>

/**
 * The prefix of every card number: two to ten capitals or digits, starting with a letter. Jira's own
 * rule, so every key we migrate (REQ, PRD, SDDEC, MARKETING…) is accepted as it is.
 */
export const spaceKeySchema = z
  .string()
  .trim()
  .transform((key) => key.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'A key is 2 to 10 letters or digits, starting with a letter'))

export const leadSchema = z.object({ id: z.uuid(), name: z.string() })

export const spaceViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  type: spaceTypeSchema,
  lead: leadSchema.nullable(),
  lastCardActivityAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime()
})
export type SpaceView = z.infer<typeof spaceViewSchema>

export const spaceListSchema = z.object({ items: z.array(spaceViewSchema) })

/** The lead defaults to whoever creates the space. */
export const createSpaceSchema = z.object({
  key: spaceKeySchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(''),
  type: spaceTypeSchema,
  leadId: z.uuid().optional()
})
export type CreateSpace = z.infer<typeof createSpaceSchema>

/** The key is not editable: it is in every card number and every link that names one. */
export const updateSpaceSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(2000).optional(),
    type: spaceTypeSchema.optional(),
    leadId: z.uuid().nullable().optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one field to change'
  })
export type UpdateSpace = z.infer<typeof updateSpaceSchema>

export const listSpacesQuerySchema = z.object({ archived: z.enum(['true', 'false']).default('false') })

export const spacePathSchema = z.object({ spaceId: z.uuid() })
export const spaceMemberPathSchema = z.object({ spaceId: z.uuid(), memberId: z.uuid() })

/** A role held by a member, with just enough of the member to draw a row of the members screen. */
export const roleHolderSchema = z.object({
  memberId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  kind: memberKindSchema,
  role: roleSchema
})
export type RoleHolder = z.infer<typeof roleHolderSchema>

export const roleHolderListSchema = z.object({ items: z.array(roleHolderSchema) })

export const setRoleSchema = z.object({ role: roleSchema })

/** A row and the name of its lead (read beside it), as the API answers it. */
export type SpaceWithLead = SpaceRow & { leadName: string | null }

export const toSpaceView = (row: SpaceWithLead): SpaceView => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  type: spaceTypeSchema.parse(row.type),
  lead: row.leadId && row.leadName ? { id: row.leadId, name: row.leadName } : null,
  lastCardActivityAt: row.lastCardActivityAt ? toIso(row.lastCardActivityAt) : null,
  archivedAt: row.archivedAt ? toIso(row.archivedAt) : null,
  createdAt: toIso(row.createdAt)
})
