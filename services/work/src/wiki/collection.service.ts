import { type Clock, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { ContentView } from '../draw/content.schemas.js'
import type { ContentService } from '../draw/content.service.js'
import { markdownToDoc } from '../draw/draft.js'
import type { DrawAccess, DrawAction, DrawGate } from '../draw/draw-gate.js'
import type { DrawSpaceRepository } from '../draw/draw-space.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CollectionRepository } from './collection.repository.js'
import {
  type CollectionRow,
  type CollectionView,
  type CreateCollection,
  CUSTOMER_OUTLINE,
  toCollectionView,
  type UpdateCollection
} from './collection.schemas.js'
import type { CreateWikiPage } from './page.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  drawGate: DrawGate
  spaces: DrawSpaceRepository
  collections: CollectionRepository
  contents: ContentService
}

/** A collection opened through its space's gate: the space must be the wiki's (ADR-0033). */
export type CollectionAccess = { gate: DrawAccess; collection: CollectionRow }

/**
 * LET’S Wiki's collections (ADR-0033): organization admins create them; their owners — the space's
 * admins — change them and give roles; everyone reads. A collection is a content space whose `area` is
 * `wiki`, so its pages are edited, versioned and commented as Draw's are.
 */
export class CollectionService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller): Promise<{ items: CollectionView[] }> {
    const actor = await this.deps.drawGate.actorOf(caller)
    const spaces = await this.deps.spaces.list(actor.organizationId, 'wiki')
    const details = await this.deps.collections.many(spaces.map((space) => space.id))
    const views = spaces.map(async (space) => {
      const collection = details.get(space.id)
      return collection ? [toCollectionView(space, collection, await this.deps.drawGate.rights(actor, space.id))] : []
    })
    return { items: (await Promise.all(views)).flat() }
  }

  async create(caller: Caller, input: CreateCollection): Promise<CollectionView> {
    const actor = await this.deps.drawGate.actorOf(caller)
    _assertOrganizationAdmin(actor)
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()
    const { reviewDays, outline, ...space } = input
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.insert(tx, {
        id,
        organizationId: actor.organizationId,
        ...space,
        area: 'wiki',
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      })
      await this.deps.spaces.addAdmin(tx, id, actor.id, now)
      await this.deps.collections.insert(tx, { spaceId: id, reviewDays, outline })
      await this._audit(tx, actor, id, 'created', diff({}, { name: input.name, reviewDays, outline, owner: actor.id }))
    })
    return await this.read(caller, id)
  }

  async read(caller: Caller, collectionId: string): Promise<CollectionView> {
    const { gate, collection } = await this.open(caller, collectionId, 'read')
    return toCollectionView(gate.space, collection, gate)
  }

  /** A new review period applies from each page's next review; dates already set stay. */
  async update(caller: Caller, collectionId: string, input: UpdateCollection): Promise<CollectionView> {
    const { gate, collection } = await this.open(caller, collectionId, 'manage')
    const { reviewDays, outline, ...space } = _defined(input)
    const before: Record<string, unknown> = {
      ...gate.space,
      reviewDays: collection.reviewDays,
      outline: collection.outline
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, collectionId, space, this.deps.clock.now())
      await this.deps.collections.update(tx, collectionId, _defined({ reviewDays, outline }))
      await this._audit(tx, gate.actor, collectionId, 'updated', diff(before, _defined(input)))
    })
    return await this.read(caller, collectionId)
  }

  /** Deleting hides the collection and its pages; the rows and their history stay. */
  async remove(caller: Caller, collectionId: string): Promise<{ items: CollectionView[] }> {
    const { gate } = await this.open(caller, collectionId, 'manage')
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, collectionId, { deletedAt: now }, now)
      await this._audit(tx, gate.actor, collectionId, 'deleted', { name: { before: gate.space.name, after: null } })
    })
    return await this.list(caller)
  }

  /** A page or a folder in the collection; a page of a customer collection starts from its outline. */
  async createPage(caller: Caller, collectionId: string, input: CreateWikiPage): Promise<ContentView> {
    const { collection } = await this.open(caller, collectionId, 'write')
    const outlined = input.kind === 'page' && collection.outline === 'customer'
    const draft = outlined ? { json: markdownToDoc(CUSTOMER_OUTLINE), text: CUSTOMER_OUTLINE } : undefined
    return await this.deps.contents.create(caller, collectionId, { ...input, draft })
  }

  /** The space behind `collectionId` through Draw's gate, refused unless it is a wiki collection. */
  async open(caller: Caller, collectionId: string, action: DrawAction): Promise<CollectionAccess> {
    const gate = await this.deps.drawGate.space(caller, collectionId, action).catch((error: unknown) => {
      throw error instanceof NotFoundException ? new NotFoundException('Collection', collectionId) : error
    })
    const collection = gate.space.area === 'wiki' ? await this.deps.collections.find(collectionId) : undefined
    if (!collection) {
      throw new NotFoundException('Collection', collectionId)
    }
    return { gate, collection }
  }

  private async _audit(tx: Database, actor: MemberRow, spaceId: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId,
      actorId: actor.id,
      entityType: 'wiki_collection',
      entityId: spaceId,
      action,
      changes
    })
  }
}

const _assertOrganizationAdmin = (actor: MemberRow): void => {
  if (!actor.isOrgAdmin) {
    throw new ForbiddenException('Only an organization admin may create a wiki collection', { memberId: actor.id })
  }
}

type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> }

const _defined = <T extends Record<string, unknown>>(input: T): Defined<T> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Defined<T>
