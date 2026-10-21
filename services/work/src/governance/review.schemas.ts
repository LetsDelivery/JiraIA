import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { accessReviewItems, accessReviews } from '../schema-governance.js'
import { privilegeSchema } from './catalog.schemas.js'

export type ReviewRow = typeof accessReviews.$inferSelect
export type ReviewItemRow = typeof accessReviewItems.$inferSelect

/** How often each privilege is reviewed (ADR-0024): a quarter for the privileged, a semester for the rest. */
export const REVIEW_PERIOD_DAYS: Record<'privileged' | 'standard', number> = { privileged: 90, standard: 180 }
/** Business days a review stays open before what is unanswered becomes a removal. */
export const REVIEW_WINDOW_DAYS = 10

export const reviewDecisionSchema = z.enum(['keep', 'remove'])
export const openReviewSchema = z.object({ privilege: privilegeSchema })
export const decideItemSchema = z.object({
  decision: reviewDecisionSchema,
  note: z.string().trim().max(1000).default('')
})
export const reviewPathSchema = z.object({ reviewId: z.uuid() })
export const reviewItemPathSchema = z.object({ reviewId: z.uuid(), entitlementId: z.uuid() })
export const listReviewsQuerySchema = z.object({ open: z.enum(['true', 'false']).optional() })

const nameRefSchema = z.object({ id: z.uuid(), name: z.string() })

export const reviewItemViewSchema = z.object({
  entitlementId: z.uuid(),
  member: z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() }),
  profile: nameRefSchema,
  grantedAt: z.iso.datetime(),
  decision: reviewDecisionSchema.nullable(),
  decided: z.object({ by: nameRefSchema, at: z.iso.datetime(), note: z.string().nullable() }).nullable(),
  /** A `remove` opened this removal; the operators carry it out like any other. */
  removalRequestId: z.uuid().nullable(),
  canDecide: z.boolean()
})
export const reviewViewSchema = z.object({
  id: z.uuid(),
  system: nameRefSchema,
  privilege: privilegeSchema,
  openedBy: nameRefSchema,
  openedAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  items: z.array(reviewItemViewSchema),
  progress: z.object({ decided: z.number().int(), total: z.number().int() })
})
export type ReviewView = z.infer<typeof reviewViewSchema>
export const reviewListSchema = z.object({ items: z.array(reviewViewSchema) })

export type ReviewRead = ReviewRow & { systemName: string; openerName: string }
export type ReviewItemRead = ReviewItemRow & {
  memberId: string
  memberName: string
  memberEmail: string | null
  profileId: string
  profileName: string
  grantedAt: Date
  deciderName: string | null
}

export const toReviewView = (
  review: ReviewRead,
  items: readonly ReviewItemRead[],
  canDecide: (item: ReviewItemRead) => boolean
): ReviewView => {
  const own = items.filter((each) => each.reviewId === review.id)
  return {
    id: review.id,
    system: { id: review.systemId, name: review.systemName },
    privilege: privilegeSchema.parse(review.privilege),
    openedBy: { id: review.openedBy, name: review.openerName },
    openedAt: toIso(review.openedAt),
    dueAt: toIso(review.dueAt),
    closedAt: review.closedAt ? toIso(review.closedAt) : null,
    items: own.map((item) => ({
      entitlementId: item.entitlementId,
      member: { id: item.memberId, name: item.memberName, email: item.memberEmail },
      profile: { id: item.profileId, name: item.profileName },
      grantedAt: toIso(item.grantedAt),
      decision: item.decision ? reviewDecisionSchema.parse(item.decision) : null,
      decided:
        item.decidedBy && item.decidedAt
          ? { by: { id: item.decidedBy, name: item.deciderName ?? '' }, at: toIso(item.decidedAt), note: item.note }
          : null,
      removalRequestId: item.removalRequestId,
      canDecide: review.closedAt === null && item.decision === null && canDecide(item)
    })),
    progress: { decided: own.filter((each) => each.decision !== null).length, total: own.length }
  }
}
