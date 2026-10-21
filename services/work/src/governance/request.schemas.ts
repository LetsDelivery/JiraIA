import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { entitlementRequests, entitlements } from '../schema-governance.js'
import { privilegeSchema } from './catalog.schemas.js'

export type EntitlementRequestRow = typeof entitlementRequests.$inferSelect
export type EntitlementRow = typeof entitlements.$inferSelect

export const requestKindSchema = z.enum(['grant', 'removal'])
export const requestOriginSchema = z.enum(['request', 'departure', 'expiry', 'review', 'inventory'])
export const requestStatusSchema = z.enum(['requested', 'approved', 'declined', 'done', 'cancelled'])
export type RequestStatus = z.infer<typeof requestStatusSchema>

/** ISO 27001 5.18 asks why; a reason of a few words is no reason. */
const reasonSchema = z.string().trim().min(10).max(1000)

export const createRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('grant'),
    profileId: z.uuid(),
    /** Whom the access is for; the caller when absent. */
    beneficiaryId: z.uuid().optional(),
    reason: reasonSchema,
    /** Required for a privileged profile, 90 days ahead at most (ADR-0024). */
    expiresAt: z.iso.datetime().optional()
  }),
  z.object({ kind: z.literal('removal'), entitlementId: z.uuid(), reason: reasonSchema })
])
export type CreateRequest = z.infer<typeof createRequestSchema>
export type CreateGrant = Extract<CreateRequest, { kind: 'grant' }>
export type CreateRemoval = Extract<CreateRequest, { kind: 'removal' }>

export const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).default('') })
export const completionSchema = z.object({ evidence: z.string().trim().min(3).max(2000) })
export const requestPathSchema = z.object({ requestId: z.uuid() })

export const listRequestsQuerySchema = z.object({
  status: requestStatusSchema.optional(),
  systemId: z.uuid().optional(),
  beneficiaryId: z.uuid().optional()
})
export type RequestFilter = z.infer<typeof listRequestsQuerySchema>
export const listEntitlementsQuerySchema = z.object({
  memberId: z.uuid().optional(),
  systemId: z.uuid().optional(),
  /** Only what is held now; `false` includes what was removed. */
  held: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true')
})
export type EntitlementFilter = z.infer<typeof listEntitlementsQuerySchema>

const personSchema = z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() })
const nameRefSchema = z.object({ id: z.uuid(), name: z.string() })
const profileRefSchema = nameRefSchema.extend({ privilege: privilegeSchema })
const stampSchema = z.object({ by: nameRefSchema, at: z.iso.datetime() })

export const requestViewSchema = z.object({
  id: z.uuid(),
  kind: requestKindSchema,
  status: requestStatusSchema,
  /** Who opened it: a person, a departure of the beneficiary, or the expiry of a grant. */
  origin: requestOriginSchema,
  /** When it must be carried out; null while a grant waits for approval. */
  dueAt: z.iso.datetime().nullable(),
  /** Whether it went past `dueAt` while open — a breach of the SLA that stays on the record. */
  overdue: z.boolean(),
  system: nameRefSchema,
  profile: profileRefSchema,
  beneficiary: personSchema,
  requester: nameRefSchema,
  reason: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  entitlementId: z.uuid().nullable(),
  decided: stampSchema.extend({ note: z.string().nullable() }).nullable(),
  completed: stampSchema.extend({ evidence: z.string().nullable() }).nullable(),
  createdAt: z.iso.datetime(),
  canDecide: z.boolean(),
  canComplete: z.boolean(),
  canCancel: z.boolean()
})
export type RequestView = z.infer<typeof requestViewSchema>
export const requestListSchema = z.object({ items: z.array(requestViewSchema) })

export const entitlementViewSchema = z.object({
  id: z.uuid(),
  system: nameRefSchema,
  profile: profileRefSchema,
  member: personSchema,
  grantRequestId: z.uuid(),
  grantReason: z.string(),
  /** How the grant came: asked by a person, or loaded from the inventory. */
  grantOrigin: requestOriginSchema,
  grantedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  removalRequestId: z.uuid().nullable(),
  removedAt: z.iso.datetime().nullable()
})
export type EntitlementView = z.infer<typeof entitlementViewSchema>
export const entitlementListSchema = z.object({ items: z.array(entitlementViewSchema) })

/** A request with the names it points at, as the repository reads it. */
export type RequestRead = EntitlementRequestRow & {
  systemName: string
  profileName: string
  privilege: string
  beneficiaryName: string
  beneficiaryEmail: string | null
  requesterName: string
  deciderName: string | null
  completerName: string | null
}
export type EntitlementRead = EntitlementRow & {
  systemName: string
  profileName: string
  privilege: string
  memberName: string
  memberEmail: string | null
  grantReason: string
  grantOrigin: string
}

export type Abilities = Pick<RequestView, 'canDecide' | 'canComplete' | 'canCancel'>

const _stamp = (by: string | null, name: string | null, at: Date | null) =>
  by && at ? { by: { id: by, name: name ?? '' }, at: toIso(at) } : null

/** Past due while still open, or carried out after the deadline. */
const _breached = (row: EntitlementRequestRow): boolean =>
  row.overdueAt !== null || (row.dueAt !== null && row.completedAt !== null && row.completedAt > row.dueAt)

export const toRequestView = (row: RequestRead, abilities: Abilities): RequestView => {
  const decided = _stamp(row.decidedBy, row.deciderName, row.decidedAt)
  const completed = _stamp(row.completedBy, row.completerName, row.completedAt)
  return {
    id: row.id,
    kind: requestKindSchema.parse(row.kind),
    status: requestStatusSchema.parse(row.status),
    origin: requestOriginSchema.parse(row.origin),
    dueAt: row.dueAt ? toIso(row.dueAt) : null,
    overdue: _breached(row),
    system: { id: row.systemId, name: row.systemName },
    profile: { id: row.profileId, name: row.profileName, privilege: privilegeSchema.parse(row.privilege) },
    beneficiary: { id: row.beneficiaryId, name: row.beneficiaryName, email: row.beneficiaryEmail },
    requester: { id: row.requesterId, name: row.requesterName },
    reason: row.reason,
    expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
    entitlementId: row.entitlementId,
    decided: decided && { ...decided, note: row.decisionNote },
    completed: completed && { ...completed, evidence: row.evidence },
    createdAt: toIso(row.createdAt),
    ...abilities
  }
}

export const toEntitlementView = (row: EntitlementRead): EntitlementView => ({
  id: row.id,
  system: { id: row.systemId, name: row.systemName },
  profile: { id: row.profileId, name: row.profileName, privilege: privilegeSchema.parse(row.privilege) },
  member: { id: row.memberId, name: row.memberName, email: row.memberEmail },
  grantRequestId: row.grantRequestId,
  grantReason: row.grantReason,
  grantOrigin: requestOriginSchema.parse(row.grantOrigin),
  grantedAt: toIso(row.grantedAt),
  expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
  removalRequestId: row.removalRequestId,
  removedAt: row.removedAt ? toIso(row.removedAt) : null
})

/** What a new request has not lived yet: no decision, no completion, no clock. */
export const BLANK_REQUEST = {
  origin: 'request',
  expiresAt: null,
  entitlementId: null,
  dueAt: null,
  overdueAt: null,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  completedBy: null,
  completedAt: null,
  evidence: null
}
