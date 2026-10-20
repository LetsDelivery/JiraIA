import { toIso } from '@jiraia/core'
import { z } from 'zod'

import { productSchema } from '../grants/grant.schemas.js'
import type { accessRequests } from '../schema.js'

export type AccessRequestRow = typeof accessRequests.$inferSelect

export const requestStatusSchema = z.enum(['pending', 'approved', 'declined'])

export const createAccessRequestSchema = z.object({
  product: productSchema,
  spaceId: z.uuid(),
  message: z.string().trim().max(1000).default('')
})
export type CreateAccessRequest = z.infer<typeof createAccessRequestSchema>

/** A space's open requests (for its admins), or — with no space named — the caller's own. */
export const accessRequestQuerySchema = z
  .object({ product: productSchema.optional(), spaceId: z.uuid().optional() })
  .refine((query) => (query.spaceId === undefined) === (query.product === undefined), {
    message: 'Send product and spaceId together'
  })

export const accessRequestPathSchema = z.object({ requestId: z.uuid() })
/** Approving gives the role asked for — member by default, so the person can edit. */
export const accessDecisionSchema = z.object({
  approve: z.boolean(),
  role: z.enum(['member', 'admin']).default('member')
})

export const accessRequestViewSchema = z.object({
  id: z.uuid(),
  product: productSchema,
  spaceId: z.uuid(),
  spaceName: z.string(),
  member: z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() }),
  message: z.string(),
  status: requestStatusSchema,
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime()
})
export type AccessRequestView = z.infer<typeof accessRequestViewSchema>
export const accessRequestListSchema = z.object({ items: z.array(accessRequestViewSchema) })

/** A request as read, with the names it is shown with. */
export type AccessRequestRead = AccessRequestRow & {
  memberName: string
  memberEmail: string | null
  spaceName: string | null
}

export const toAccessRequestView = (row: AccessRequestRead): AccessRequestView => ({
  id: row.id,
  product: productSchema.parse(row.product),
  spaceId: row.spaceId,
  spaceName: row.spaceName ?? '',
  member: { id: row.memberId, name: row.memberName, email: row.memberEmail },
  message: row.message,
  status: requestStatusSchema.parse(row.status),
  decidedAt: row.decidedAt ? toIso(row.decidedAt) : null,
  createdAt: toIso(row.createdAt)
})
