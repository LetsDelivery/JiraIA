import { type Clock, ConflictException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, diff } from '../audit/audit.js'
import type { ContentView } from '../draw/content.schemas.js'
import type { ContentService } from '../draw/content.service.js'
import { markdownToDoc } from '../draw/draft.js'
import type { DrawGate } from '../draw/draw-gate.js'
import { CUSTOMER_OUTLINE } from './collection.schemas.js'
import type { CollectionService } from './collection.service.js'
import type { WikiPageRepository } from './page.repository.js'
import { type CreateWikiPage, draftOf } from './page.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  drawGate: DrawGate
  collections: CollectionService
  contents: ContentService
  pages: WikiPageRepository
}

/**
 * New pages in a collection (ADR-0033, ADR-0034): written there — a customer collection's start from
 * its outline — or copied from a draft elsewhere: a Draw page, or a page of the caller's personal
 * collection. A copy is a draft its publisher owns, with a link back; the original stays.
 */
export class WikiContentService {
  constructor(private readonly deps: Deps) {}

  async createPage(caller: Caller, collectionId: string, input: CreateWikiPage): Promise<ContentView> {
    const { collection } = await this.deps.collections.open(caller, collectionId, 'write')
    const { blank, ...content } = input
    const outlined = content.kind === 'page' && collection.outline === 'customer' && !blank
    const draft = outlined ? { json: markdownToDoc(CUSTOMER_OUTLINE), text: CUSTOMER_OUTLINE } : undefined
    return await this.deps.contents.create(caller, collectionId, { ...content, draft })
  }

  /** "Publicar na Wiki" (W8): the source as last derived, at the top of the collection, as a draft. */
  async publish(caller: Caller, collectionId: string, sourceId: string): Promise<ContentView> {
    const { gate, content } = await this.deps.drawGate.openDocument(caller, sourceId, 'read')
    if (content.kind !== 'page' || !(await this._publishable(caller, gate.space.area, content.spaceId))) {
      throw new ConflictException(
        `"${content.title}" is neither a Draw page nor a personal one; only those are published to a collection`,
        { contentId: sourceId }
      )
    }
    await this.deps.collections.open(caller, collectionId, 'write')
    const draft = { json: content.contentJson as Record<string, unknown>, text: content.contentText }
    const icon = content.icon ?? undefined
    const created = await this.deps.contents.create(caller, collectionId, {
      kind: 'page',
      title: content.title,
      draft,
      ...(icon ? { icon } : {})
    })
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.pages.save(tx, { ...draftOf(created.id, gate.actor.id, now), sourceId })
      await this.deps.audit.record(tx, {
        organizationId: gate.actor.organizationId,
        spaceId: collectionId,
        actorId: gate.actor.id,
        entityType: 'wiki_collection',
        entityId: collectionId,
        action: 'published',
        changes: diff({}, { contentId: created.id, sourceId })
      })
    })
    return created
  }

  /** A Draw page, or a page of a personal collection the caller reads. */
  private async _publishable(caller: Caller, area: string, spaceId: string): Promise<boolean> {
    if (area === 'draw') {
      return true
    }
    const { collection } = await this.deps.collections.open(caller, spaceId, 'read')
    return collection.access === 'personal'
  }
}
