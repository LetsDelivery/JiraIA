import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail, Changes } from '../audit/audit.js'
import type { MemberRow } from '../members/schemas.js'
import type { SystemActors } from '../members/system-actor.js'
import { addBusinessDays } from './calendar.js'
import type { CatalogRepository } from './catalog.repository.js'
import type { SystemRow } from './catalog.schemas.js'
import type { HolidayRepository, SlaClock } from './holidays.js'
import type { Removals } from './removals.js'
import type { EntitlementRequestRepository } from './request.repository.js'
import type { ReviewCandidate, ReviewRepository } from './review.repository.js'
import {
  REVIEW_PERIOD_DAYS,
  REVIEW_WINDOW_DAYS,
  type ReviewItemRead,
  type ReviewRead,
  type ReviewRow,
  type ReviewView,
  toReviewView
} from './review.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  catalog: CatalogRepository
  requests: EntitlementRequestRepository
  reviews: ReviewRepository
  holidays: HolidayRepository
  sla: SlaClock
  removals: Removals
  system: SystemActors
}

type Privilege = 'privileged' | 'standard'
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Periodic access reviews (ADR-0024, ISO 27001 5.18). A system's owners confirm or remove each
 * entitlement of one privilege; a removal goes to the operators like any other. Nobody reviews their
 * own access. What is left unanswered when the window closes is removed — least access by default.
 */
export class ReviewService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, open?: boolean): Promise<{ items: ReviewView[] }> {
    const actor = await this.deps.access.actor(caller)
    const systems = await this._visibleSystems(actor)
    const rows = await this.deps.reviews.list(actor.organizationId, systems, open)
    return { items: await this._views(actor, rows) }
  }

  async read(caller: Caller, reviewId: string): Promise<ReviewView> {
    const actor = await this.deps.access.actor(caller)
    const [view] = await this._views(actor, [await this._find(actor, reviewId)])
    return view as ReviewView
  }

  /** An owner opens one now, before the schedule does. */
  async open(caller: Caller, systemId: string, privilege: Privilege): Promise<ReviewView> {
    const actor = await this.deps.access.actor(caller)
    const system = await this.deps.catalog.system(actor.organizationId, systemId)
    if (!system) {
      throw new NotFoundException('System', systemId)
    }
    await this._assertOwns(actor, system)
    const id = await this._open(system, privilege, actor.id)
    return await this.read(caller, id)
  }

  async decide(
    caller: Caller,
    reviewId: string,
    entitlementId: string,
    input: { decision: 'keep' | 'remove'; note: string }
  ) {
    const actor = await this.deps.access.actor(caller)
    const review = await this._find(actor, reviewId)
    const system = await this._system(review.organizationId, review.systemId)
    await this._assertOwns(actor, system)
    const item = (await this.deps.reviews.items([review.id])).find((each) => each.entitlementId === entitlementId)
    if (!item || review.closedAt || item.decision) {
      throw new ConflictException(`Item "${entitlementId}" of review "${review.id}" is not waiting for a decision`, {
        reviewItem: entitlementId
      })
    }
    if (item.memberId === actor.id) {
      throw new ForbiddenException(`You may not review your own access in review "${review.id}"`, { reviewId })
    }
    await this._decide(review, system, item, { ...input, actorId: actor.id, requesterId: actor.id })
    return await this.read(caller, reviewId)
  }

  /** The schedule: opens what is due, by Automação, and closes what ran out. */
  async sweep(): Promise<{ opened: number; closed: number }> {
    let opened = 0
    for (const candidate of await this.deps.reviews.candidates()) {
      opened += (await this._openIfDue(candidate)) ? 1 : 0
    }
    const expired = await this.deps.reviews.expired(this.deps.clock.now())
    for (const review of expired) {
      await this._expire(review)
    }
    return { opened, closed: expired.length }
  }

  private async _openIfDue(candidate: ReviewCandidate): Promise<boolean> {
    const privilege = candidate.privilege === 'privileged' ? 'privileged' : 'standard'
    const anchor = (await this.deps.reviews.lastOpened(candidate.systemId, privilege)) ?? candidate.firstGranted
    const due = anchor.getTime() + REVIEW_PERIOD_DAYS[privilege] * DAY_MS <= this.deps.clock.now().getTime()
    if (!due || (await this.deps.reviews.openFor(candidate.systemId, privilege))) {
      return false
    }
    const automation = await this.deps.system.automation(candidate.organizationId)
    await this._open(await this._system(candidate.organizationId, candidate.systemId), privilege, automation.member.id)
    return true
  }

  private async _open(system: SystemRow, privilege: Privilege, openedBy: string): Promise<string> {
    if (await this.deps.reviews.openFor(system.id, privilege)) {
      throw new ConflictException(`A ${privilege} review of system "${system.name}" is already open`, {
        openReview: system.name
      })
    }
    const held = await this.deps.reviews.held(system.id, privilege)
    if (held.length === 0) {
      throw new ConflictException(`System "${system.name}" has no ${privilege} access to review`, {
        emptyReview: system.name
      })
    }
    const now = this.deps.clock.now()
    const id = this.deps.ids.next()
    const dueAt = addBusinessDays(now, REVIEW_WINDOW_DAYS, await this.deps.holidays.days(system.organizationId))
    const review = {
      id,
      organizationId: system.organizationId,
      systemId: system.id,
      privilege,
      openedBy,
      openedAt: now,
      dueAt,
      closedAt: null
    }
    const items = held.map((each) => ({ ...BLANK_ITEM, reviewId: id, entitlementId: each.id }))
    await this.deps.db.transaction(async (tx) => {
      await this.deps.reviews.insert(tx, review, items)
      await this._audit(tx, system.organizationId, openedBy, id, 'opened', {
        privilege: { before: null, after: privilege },
        items: { before: null, after: items.length }
      })
    })
    return id
  }

  /** Unanswered items are removed by Automação, and the review closes. */
  private async _expire(review: ReviewRow) {
    const system = await this._system(review.organizationId, review.systemId)
    const automation = await this.deps.system.automation(review.organizationId)
    const id = automation.member.id
    for (const item of (await this.deps.reviews.items([review.id])).filter((each) => !each.decision)) {
      await this._decide(review, system, item, { decision: 'remove', note: 'unanswered', actorId: id, requesterId: id })
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.reviews.close(tx, review.id, this.deps.clock.now())
      await this._audit(tx, review.organizationId, id, review.id, 'closed', {
        closedAt: { before: null, after: 'expired' }
      })
    })
  }

  private async _decide(
    review: { id: string; organizationId: string },
    system: SystemRow,
    item: ReviewItemRead,
    input: { decision: 'keep' | 'remove'; note: string; actorId: string; requesterId: string }
  ): Promise<void> {
    const now = this.deps.clock.now()
    const dueAt = input.decision === 'remove' ? await this.deps.sla.removal(system, now) : null
    await this.deps.db.transaction(async (tx) => {
      const removalRequestId = dueAt ? await this._removal(tx, review.organizationId, item, input, dueAt) : null
      const fields = {
        decision: input.decision,
        decidedBy: input.actorId,
        decidedAt: now,
        note: input.note || null,
        removalRequestId
      }
      await this.deps.reviews.decide(tx, review.id, item.entitlementId, fields)
      await this._audit(tx, review.organizationId, input.actorId, review.id, 'item_decided', {
        [item.entitlementId]: { before: null, after: input.decision }
      })
      await this._closeIfDone(tx, review, input.actorId, now)
    })
  }

  /** A removal for the item — unless the entitlement already ended or is already being removed. */
  private async _removal(
    tx: Database,
    organizationId: string,
    item: ReviewItemRead,
    input: { actorId: string; requesterId: string },
    dueAt: Date
  ): Promise<string | null> {
    const entitlement = await this.deps.requests.entitlement(organizationId, item.entitlementId)
    const removing = await this.deps.requests.openFor(item.profileId, item.memberId, 'removal')
    if (!entitlement || entitlement.removedAt || removing) {
      return removing?.id ?? null
    }
    const cause = { organizationId, ...input, origin: 'review' as const, at: this.deps.clock.now() }
    return await this.deps.removals.open(tx, cause, entitlement, dueAt)
  }

  private async _closeIfDone(tx: Database, review: { id: string; organizationId: string }, actorId: string, at: Date) {
    if ((await this.deps.reviews.pending(tx, review.id)) === 0) {
      await this.deps.reviews.close(tx, review.id, at)
      await this._audit(tx, review.organizationId, actorId, review.id, 'closed', {
        closedAt: { before: null, after: 'decided' }
      })
    }
  }

  private async _views(actor: MemberRow, rows: readonly ReviewRead[]): Promise<ReviewView[]> {
    const items = await this.deps.reviews.items(rows.map((row) => row.id))
    const owned = new Set(
      (await this.deps.catalog.dutiesOf(actor.id)).filter((each) => each.duty === 'owner').map((each) => each.systemId)
    )
    return rows.map((row) =>
      toReviewView(row, items, (item) => (actor.isOrgAdmin || owned.has(row.systemId)) && item.memberId !== actor.id)
    )
  }

  /** Auditors and admins see every review; staff, their systems'; nobody else, any. */
  private async _visibleSystems(actor: MemberRow): Promise<string[] | undefined> {
    if (actor.isOrgAdmin || actor.isAccessAuditor) {
      return undefined
    }
    return (await this.deps.catalog.dutiesOf(actor.id)).map((each) => each.systemId)
  }

  private async _find(actor: MemberRow, reviewId: string): Promise<ReviewRead> {
    const review = await this.deps.reviews.find(actor.organizationId, reviewId)
    const systems = await this._visibleSystems(actor)
    if (!review || (systems && !systems.includes(review.systemId))) {
      throw new NotFoundException('Access review', reviewId)
    }
    return review
  }

  private async _system(organizationId: string, systemId: string): Promise<SystemRow> {
    const system = await this.deps.catalog.system(organizationId, systemId)
    if (!system) {
      throw new NotFoundException('System', systemId)
    }
    return system
  }

  private async _assertOwns(actor: MemberRow, system: SystemRow): Promise<void> {
    const duties = await this.deps.catalog.dutiesOf(actor.id)
    if (!actor.isOrgAdmin && !duties.some((each) => each.systemId === system.id && each.duty === 'owner')) {
      throw new ForbiddenException(`Only an owner of system "${system.name}" may review its access`, {
        systemId: system.id
      })
    }
  }

  private async _audit(
    tx: Database,
    organizationId: string,
    actorId: string,
    id: string,
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId,
      spaceId: null,
      actorId,
      entityType: 'access_review',
      entityId: id,
      action,
      changes
    })
  }
}

const BLANK_ITEM = { decision: null, decidedBy: null, decidedAt: null, note: null, removalRequestId: null }
