import {
  type Clock,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  toIso,
  ValidationException
} from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { ContentRepository } from '../draw/content.repository.js'
import { toContentNode } from '../draw/content.schemas.js'
import type { DrawAction, DrawGate } from '../draw/draw-gate.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { CollectionAccess, CollectionService } from './collection.service.js'
import type { WikiPageRepository } from './page.repository.js'
import {
  draftOf,
  dueAfter,
  isOverdue,
  pageStateSchema,
  toWikiPageView,
  type WikiPageRow,
  type WikiPageView
} from './page.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  drawGate: DrawGate
  collections: CollectionService
  contents: ContentRepository
  pages: WikiPageRepository
  members: MemberRepository
}

/** A wiki page opened with its collection, and its row — or the draft it is until it has one. */
type PageAccess = CollectionAccess & { row: WikiPageRow; contentId: string; title: string }

/**
 * What makes a wiki page something to trust (ADR-0033): an owner who answers for it, a state — draft
 * or official — and, once official, a review date its owner moves on by confirming it still holds.
 * Its text is edited as any Draw page's, through the content and document routes.
 */
export class WikiPageService {
  constructor(private readonly deps: Deps) {}

  async read(caller: Caller, contentId: string): Promise<WikiPageView> {
    return await this._view(await this._open(caller, contentId, 'read'))
  }

  /** A star is the member's own (ADR-0034): not audited, and gone from view once they cannot read the page. */
  async favorite(caller: Caller, contentId: string, on: boolean): Promise<WikiPageView> {
    const access = await this._open(caller, contentId, 'read')
    const memberId = access.gate.actor.id
    await (on
      ? this.deps.pages.favorite(memberId, contentId, this.deps.clock.now())
      : this.deps.pages.unfavorite(memberId, contentId))
    return await this._view(access)
  }

  /** The collection's tree, each line with its page's state, owner and icon (ADR-0034). */
  async tree(caller: Caller, collectionId: string) {
    const { gate } = await this.deps.collections.open(caller, collectionId, 'read')
    const [nodes, people] = await Promise.all([
      this.deps.contents.tree(collectionId),
      this.deps.members.list(gate.actor.organizationId)
    ])
    const rows = await this.deps.pages.many(nodes.map((node) => node.id))
    const names = new Map(people.map((person) => [person.id, person.name]))
    const now = this.deps.clock.now()
    return {
      items: nodes.map((node) => {
        const row = rows.get(node.id) ?? draftOf(node.id, node.createdBy, node.createdAt)
        const owner = { id: row.ownerId, name: names.get(row.ownerId) ?? '' }
        const reviewDue = row.reviewDue ? toIso(row.reviewDue) : null
        return {
          ...toContentNode(node),
          state: pageStateSchema.parse(row.state),
          reviewDue,
          overdue: isOverdue(row, now),
          owner
        }
      })
    }
  }

  /** Owners of the collection make a page official, which starts its review period, or a draft again. */
  async setOfficial(caller: Caller, contentId: string, official: boolean): Promise<WikiPageView> {
    const access = await this._open(caller, contentId, 'manage')
    if (official && access.collection.access === 'personal') {
      throw new ConflictException(
        `Page "${access.title}" is personal; publish it to a collection to make it official`,
        {
          contentId
        }
      )
    }
    const now = this.deps.clock.now()
    const next: WikiPageRow = official
      ? { ...access.row, state: 'official', officialAt: now, reviewedAt: now, reviewDue: this._due(access, now) }
      : { ...access.row, state: 'draft', officialAt: null, reviewDue: null }
    await this._save(access, next, official ? 'made_official' : 'made_draft')
    return await this.read(caller, contentId)
  }

  /** The owner, or an owner of the collection, confirms an official page still holds. */
  async review(caller: Caller, contentId: string): Promise<WikiPageView> {
    const access = await this._open(caller, contentId, 'read')
    this._assertReviews(access)
    if (access.row.state !== 'official') {
      throw new ConflictException(`Page "${access.title}" is a draft; only an official page is reviewed`, { contentId })
    }
    const now = this.deps.clock.now()
    await this._save(access, { ...access.row, reviewedAt: now, reviewDue: this._due(access, now) }, 'reviewed')
    return await this.read(caller, contentId)
  }

  /** The page's owner hands it on, or an owner of the collection names one; it must be an active member. */
  async changeOwner(caller: Caller, contentId: string, ownerId: string): Promise<WikiPageView> {
    const access = await this._open(caller, contentId, 'read')
    this._assertReviews(access)
    const owner = await this.deps.members.findById(access.gate.actor.organizationId, ownerId)
    if (owner?.status !== 'active') {
      throw new ValidationException(`Member "${ownerId}" is not an active member; a page needs one as its owner`, {
        ownerId
      })
    }
    await this._save(access, { ...access.row, ownerId }, 'owner_changed')
    return await this.read(caller, contentId)
  }

  private async _open(caller: Caller, contentId: string, action: DrawAction): Promise<PageAccess> {
    const { content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    const access = await this.deps.collections.open(caller, content.spaceId, action).catch((error: unknown) => {
      throw error instanceof NotFoundException ? new NotFoundException('Wiki page', contentId) : error
    })
    const row = (await this.deps.pages.find(contentId)) ?? draftOf(contentId, content.createdBy, content.createdAt)
    return { ...access, row, contentId, title: content.title }
  }

  private async _view(access: PageAccess): Promise<WikiPageView> {
    const [owner, favorite] = await Promise.all([
      this.deps.members.findById(access.gate.actor.organizationId, access.row.ownerId),
      this.deps.pages.isFavorite(access.gate.actor.id, access.contentId)
    ])
    return toWikiPageView(access.row, {
      collectionId: access.gate.space.id,
      ownerName: owner?.name ?? '',
      favorite,
      personal: access.collection.access === 'personal',
      now: this.deps.clock.now(),
      canManage: access.gate.canManage,
      canReview: _reviews(access)
    })
  }

  private _assertReviews(access: PageAccess): void {
    if (!_reviews(access)) {
      throw new ForbiddenException(
        `Only the owner of page "${access.title}" or an owner of its collection may do this`,
        {
          contentId: access.contentId
        }
      )
    }
  }

  private _due(access: PageAccess, from: Date): Date {
    return dueAfter(from, access.collection.reviewDays)
  }

  private async _save(access: PageAccess, next: WikiPageRow, action: string): Promise<void> {
    const row = { ...next, updatedAt: this.deps.clock.now() }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.pages.save(tx, row)
      await this._audit(tx, access, action, diff(_audited(access.row), _audited(row)))
    })
  }

  private async _audit(tx: Database, access: PageAccess, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: access.gate.actor.organizationId,
      spaceId: access.gate.space.id,
      actorId: access.gate.actor.id,
      entityType: 'wiki_page',
      entityId: access.contentId,
      action,
      changes
    })
  }
}

const _reviews = (access: PageAccess): boolean => access.gate.canManage || access.row.ownerId === access.gate.actor.id

const _audited = (row: WikiPageRow) => ({
  ownerId: row.ownerId,
  state: row.state,
  reviewDue: row.reviewDue ? toIso(row.reviewDue) : null
})
