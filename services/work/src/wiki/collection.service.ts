import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { DrawAccess, DrawAction, DrawGate } from '../draw/draw-gate.js'
import type { DrawSpaceRepository } from '../draw/draw-space.repository.js'
import type { DrawSpaceWithCreator } from '../draw/draw-space.schemas.js'
import type { MemberRow } from '../members/schemas.js'
import type { CollectionRepository } from './collection.repository.js'
import {
  type CollectionRow,
  type CollectionView,
  type CreateCollection,
  EMPTY_STATS,
  toCollectionView,
  type UpdateCollection
} from './collection.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  drawGate: DrawGate
  spaces: DrawSpaceRepository
  collections: CollectionRepository
}

/** A collection opened through its space's gate: the space must be the wiki's (ADR-0033). */
export type CollectionAccess = { gate: DrawAccess; collection: CollectionRow }

/** A collection the member reads, with what they may do in it. */
export type Readable = {
  space: DrawSpaceWithCreator
  collection: CollectionRow
  canWrite: boolean
  canManage: boolean
}

/**
 * LET’S Wiki's collections (ADR-0033, ADR-0034): organization admins create them, open to all of LET’S
 * or restricted to whoever holds a role; each member also has a personal one. Owners — the space's
 * admins — change them and give roles. Whoever cannot read one never sees it.
 */
export class CollectionService {
  constructor(private readonly deps: Deps) {}

  /** "Todas as coleções": the open and restricted collections the caller reads, with owners and counts. */
  async list(caller: Caller): Promise<{ items: CollectionView[] }> {
    const actor = await this.deps.drawGate.actorOf(caller)
    const readable = (await this.readable(actor)).filter((each) => each.collection.access !== 'personal')
    return { items: await this.views(readable) }
  }

  /** Every collection of the organization the member reads — personal ones included — by name. */
  async readable(actor: MemberRow): Promise<Readable[]> {
    const spaces = await this.deps.spaces.list(actor.organizationId, 'wiki')
    const details = await this.deps.collections.many(spaces.map((space) => space.id))
    const rows = await Promise.all(
      spaces.map(async (space) => {
        const collection = details.get(space.id)
        const rights = collection ? await this.deps.drawGate.rights(actor, space.id) : undefined
        return collection && rights?.canRead ? [{ space, collection, ...rights }] : []
      })
    )
    return rows.flat()
  }

  /** Views with their owners and counts, read for all of them at once. */
  async views(readable: readonly Readable[]): Promise<CollectionView[]> {
    const ids = readable.map((each) => each.space.id)
    const [counts, owners, people] = await Promise.all([
      this.deps.collections.pageCounts(ids, this.deps.clock.now()),
      this.deps.collections.owners(ids),
      this.deps.collections.peopleCounts(ids)
    ])
    return readable.map(({ space, collection, canWrite, canManage }) => {
      const stats = { ...EMPTY_STATS, ...counts.get(space.id), people: people.get(space.id) ?? 0 }
      const personalOwner = collection.ownerId ? { id: collection.ownerId, name: space.creatorName } : null
      return toCollectionView(space, collection, {
        canWrite,
        canManage,
        owners: owners.get(space.id),
        stats,
        personalOwner
      })
    })
  }

  async create(caller: Caller, input: CreateCollection): Promise<CollectionView> {
    const actor = await this.deps.drawGate.actorOf(caller)
    _assertOrganizationAdmin(actor)
    const id = this.deps.ids.next()
    const { reviewDays, outline, access, ...space } = input
    await this._insert(actor, { id, ...space }, { spaceId: id, reviewDays, outline, access, ownerId: null })
    return await this.read(caller, id)
  }

  /** The caller's personal collection (ADR-0034), made the first time they ask for it. */
  async personal(caller: Caller): Promise<CollectionView> {
    const actor = await this.deps.drawGate.actorOf(caller)
    const existing = await this.deps.collections.personalOf(actor.id)
    if (existing) {
      return await this.read(caller, existing.spaceId)
    }
    const id = this.deps.ids.next()
    const space = { id, name: 'Privado', description: 'Suas páginas, só suas até você convidar alguém.', icon: '🔒' }
    await this._insert(actor, space, {
      spaceId: id,
      reviewDays: 90,
      outline: null,
      access: 'personal',
      ownerId: actor.id
    })
    return await this.read(caller, id)
  }

  async read(caller: Caller, collectionId: string): Promise<CollectionView> {
    const { gate, collection } = await this.open(caller, collectionId, 'read')
    const [view] = await this.views([
      { space: gate.space, collection, canWrite: gate.canWrite, canManage: gate.canManage }
    ])
    return view as CollectionView
  }

  /** A new review period applies from each page's next review. A personal collection stays personal. */
  async update(caller: Caller, collectionId: string, input: UpdateCollection): Promise<CollectionView> {
    const { gate, collection } = await this.open(caller, collectionId, 'manage')
    if (collection.access === 'personal' && input.access) {
      throw new ConflictException(`Collection "${gate.space.name}" is personal; its access does not change`, {
        collectionId
      })
    }
    const { reviewDays, outline, access, ...space } = _defined(input)
    const before: Record<string, unknown> = { ...gate.space, ...collection }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, collectionId, space, this.deps.clock.now())
      await this.deps.collections.update(tx, collectionId, _defined({ reviewDays, outline, access }))
      await this._audit(tx, gate.actor, collectionId, 'updated', diff(before, _defined(input)))
    })
    return await this.read(caller, collectionId)
  }

  /** Deleting hides the collection and its pages; the rows and their history stay. A personal one stays. */
  async remove(caller: Caller, collectionId: string): Promise<{ items: CollectionView[] }> {
    const { gate, collection } = await this.open(caller, collectionId, 'manage')
    if (collection.access === 'personal') {
      throw new ConflictException(`Collection "${gate.space.name}" is personal; it is not deleted`, { collectionId })
    }
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, collectionId, { deletedAt: now }, now)
      await this._audit(tx, gate.actor, collectionId, 'deleted', { name: { before: gate.space.name, after: null } })
    })
    return await this.list(caller)
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

  private async _insert(
    actor: MemberRow,
    space: { id: string; name: string; description: string; icon: string },
    collection: CollectionRow
  ): Promise<void> {
    const now = this.deps.clock.now()
    const row = { ...space, organizationId: actor.organizationId, area: 'wiki', createdBy: actor.id }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.insert(tx, { ...row, createdAt: now, updatedAt: now, deletedAt: null })
      await this.deps.spaces.addAdmin(tx, space.id, actor.id, now)
      await this.deps.collections.insert(tx, collection)
      const { spaceId: _spaceId, ...settings } = collection
      await this._audit(tx, actor, space.id, 'created', diff({}, { name: space.name, ...settings, owner: actor.id }))
    })
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
