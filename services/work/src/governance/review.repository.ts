import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, max, min, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { members } from '../schema.js'
import { accessProfiles, accessReviewItems, accessReviews, accessSystems, entitlements } from '../schema-governance.js'
import type { EntitlementRow } from './request.schemas.js'
import type { ReviewItemRead, ReviewItemRow, ReviewRead, ReviewRow } from './review.schemas.js'

const opener = alias(members, 'opener')
const holder = alias(members, 'holder')
const decider = alias(members, 'decider')

/** A system and privilege that has something held, and since when the oldest of it is held. */
export type ReviewCandidate = { organizationId: string; systemId: string; privilege: string; firstGranted: Date }

export class ReviewRepository {
  constructor(private readonly db: Database) {}

  async find(organizationId: string, id: string): Promise<ReviewRead | undefined> {
    const [row] = await this._reviews(and(eq(accessReviews.organizationId, organizationId), eq(accessReviews.id, id)))
    return row
  }

  /** The reviews of these systems — or of every system, for `undefined` — newest first. */
  async list(organizationId: string, systemIds: readonly string[] | undefined, open?: boolean): Promise<ReviewRead[]> {
    return await this._reviews(
      and(
        eq(accessReviews.organizationId, organizationId),
        systemIds
          ? inArray(
              accessReviews.systemId,
              systemIds.length ? [...systemIds] : ['00000000-0000-0000-0000-000000000000']
            )
          : undefined,
        open === undefined ? undefined : open ? isNull(accessReviews.closedAt) : isNotNull(accessReviews.closedAt)
      )
    )
  }

  async openFor(systemId: string, privilege: string): Promise<ReviewRow | undefined> {
    const [row] = await this.db
      .select()
      .from(accessReviews)
      .where(
        and(
          eq(accessReviews.systemId, systemId),
          eq(accessReviews.privilege, privilege),
          isNull(accessReviews.closedAt)
        )
      )
    return row
  }

  async lastOpened(systemId: string, privilege: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: max(accessReviews.openedAt) })
      .from(accessReviews)
      .where(and(eq(accessReviews.systemId, systemId), eq(accessReviews.privilege, privilege)))
    return row?.at ?? null
  }

  /** What is held now in one system, of one privilege — what a review covers. */
  async held(systemId: string, privilege: string): Promise<EntitlementRow[]> {
    return await this.db
      .select({ entitlement: entitlements })
      .from(entitlements)
      .innerJoin(accessProfiles, eq(accessProfiles.id, entitlements.profileId))
      .where(
        and(
          eq(entitlements.systemId, systemId),
          eq(accessProfiles.privilege, privilege),
          isNull(entitlements.removedAt)
        )
      )
      .then((rows) => rows.map((row) => row.entitlement))
  }

  /** Every system and privilege with something held, across organizations. */
  async candidates(): Promise<ReviewCandidate[]> {
    const rows = await this.db
      .select({
        organizationId: entitlements.organizationId,
        systemId: entitlements.systemId,
        privilege: accessProfiles.privilege,
        firstGranted: min(entitlements.grantedAt)
      })
      .from(entitlements)
      .innerJoin(accessProfiles, eq(accessProfiles.id, entitlements.profileId))
      .innerJoin(accessSystems, eq(accessSystems.id, entitlements.systemId))
      .where(and(isNull(entitlements.removedAt), isNull(accessSystems.archivedAt)))
      .groupBy(entitlements.organizationId, entitlements.systemId, accessProfiles.privilege)
    return rows.flatMap((row) => (row.firstGranted ? [{ ...row, firstGranted: row.firstGranted }] : []))
  }

  /** Open reviews past their window, across organizations. */
  async expired(now: Date): Promise<ReviewRow[]> {
    return await this.db
      .select()
      .from(accessReviews)
      .where(and(isNull(accessReviews.closedAt), lte(accessReviews.dueAt, now)))
      .limit(50)
  }

  async items(reviewIds: readonly string[]): Promise<ReviewItemRead[]> {
    if (reviewIds.length === 0) {
      return []
    }
    const rows = await this.db
      .select({
        item: accessReviewItems,
        memberId: entitlements.memberId,
        memberName: holder.name,
        memberEmail: holder.email,
        profileId: entitlements.profileId,
        profileName: accessProfiles.name,
        grantedAt: entitlements.grantedAt,
        deciderName: decider.name
      })
      .from(accessReviewItems)
      .innerJoin(entitlements, eq(entitlements.id, accessReviewItems.entitlementId))
      .innerJoin(holder, eq(holder.id, entitlements.memberId))
      .innerJoin(accessProfiles, eq(accessProfiles.id, entitlements.profileId))
      .leftJoin(decider, eq(decider.id, accessReviewItems.decidedBy))
      .where(inArray(accessReviewItems.reviewId, [...reviewIds]))
      .orderBy(asc(holder.name), asc(accessProfiles.name))
    return rows.map(({ item, ...rest }) => ({ ...item, ...rest }))
  }

  async insert(tx: Database, review: ReviewRow, items: readonly ReviewItemRow[]): Promise<void> {
    await tx.insert(accessReviews).values(review)
    if (items.length > 0) {
      await tx.insert(accessReviewItems).values([...items])
    }
  }

  async decide(tx: Database, reviewId: string, entitlementId: string, fields: Partial<ReviewItemRow>): Promise<void> {
    await tx
      .update(accessReviewItems)
      .set(fields)
      .where(and(eq(accessReviewItems.reviewId, reviewId), eq(accessReviewItems.entitlementId, entitlementId)))
  }

  /** Items still undecided, read inside the transaction that just decided one. */
  async pending(tx: Database, reviewId: string): Promise<number> {
    const rows = await tx
      .select({ entitlementId: accessReviewItems.entitlementId })
      .from(accessReviewItems)
      .where(and(eq(accessReviewItems.reviewId, reviewId), isNull(accessReviewItems.decision)))
    return rows.length
  }

  async close(tx: Database, id: string, at: Date): Promise<void> {
    await tx.update(accessReviews).set({ closedAt: at }).where(eq(accessReviews.id, id))
  }

  private async _reviews(where: SQL | undefined): Promise<ReviewRead[]> {
    const rows = await this.db
      .select({ review: accessReviews, systemName: accessSystems.name, openerName: opener.name })
      .from(accessReviews)
      .innerJoin(accessSystems, eq(accessSystems.id, accessReviews.systemId))
      .innerJoin(opener, eq(opener.id, accessReviews.openedBy))
      .where(where)
      .orderBy(desc(accessReviews.openedAt))
      .limit(200)
    return rows.map(({ review, ...names }) => ({ ...review, ...names }))
  }
}
