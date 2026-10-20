import { can } from '@jiraia/authorization'
import { type Clock, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { CardView } from '../cards/schemas.js'
import type { MemberRow } from '../members/schemas.js'
import type { SearchService } from '../search/search.service.js'
import type { SpaceGate } from '../spaces/space-gate.js'
import type { ViewRepository } from './view.repository.js'
import { type CreateView, toViewView, type UpdateView, type ViewView, type ViewWithOwner } from './view.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  gate: SpaceGate
  views: ViewRepository
  search: SearchService
}

/** The most cards a view answers with at once. */
const VIEW_LIMIT = 500

type Opened = { actor: MemberRow; row: ViewWithOwner; canEdit: boolean }

/**
 * Saved views (escopo-mvp 3.5), the replacement for saved JQL queries. Anyone who reads a space may
 * keep personal views; a member of it may share one with the space. A view is changed by its owner
 * or by an admin of its space.
 */
export class ViewService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId?: string): Promise<{ items: ViewView[] }> {
    const actor = await this.deps.gate.actorOf(caller)
    if (spaceId) {
      await this.deps.gate.check(caller, spaceId, 'space:read')
    }
    const rows = await this.deps.views.visible({
      organizationId: actor.organizationId,
      ownerId: actor.id,
      readable: 'all',
      spaceId
    })
    return { items: await Promise.all(rows.map(async (row) => toViewView(row, await this._canEdit(actor, row)))) }
  }

  async create(caller: Caller, input: CreateView): Promise<ViewView> {
    const actor = await this.deps.gate.actorOf(caller)
    if (input.spaceId) {
      await this.deps.gate.check(caller, input.spaceId, input.scope === 'space' ? 'space:write' : 'space:read')
    }
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()
    const row = {
      ...input,
      id,
      organizationId: actor.organizationId,
      ownerId: actor.id,
      spaceId: input.spaceId ?? null
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.views.insert(tx, { ...row, createdAt: now, updatedAt: now })
      await this._audit(tx, actor, row, 'created', diff({}, { name: input.name, scope: input.scope }))
    })
    return await this.read(caller, id)
  }

  async read(caller: Caller, viewId: string): Promise<ViewView> {
    const { row, canEdit } = await this._open(caller, viewId)
    return toViewView(row, canEdit)
  }

  /** The view's cards, as its filter finds them now, for the caller. */
  async cards(caller: Caller, viewId: string): Promise<{ items: CardView[] }> {
    const { actor, row } = await this._open(caller, viewId)
    const view = toViewView(row, false)
    return { items: await this.deps.search.run(actor, { filter: view.filter, order: view.order, limit: VIEW_LIMIT }) }
  }

  async update(caller: Caller, viewId: string, input: UpdateView): Promise<ViewView> {
    const { actor, row } = await this._openToEdit(caller, viewId)
    const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      await this.deps.views.update(tx, row.id, fields, now)
      await this._audit(tx, actor, row, 'updated', _changes(row, fields))
    })
    return await this.read(caller, viewId)
  }

  /** Answers with the views still listed where this one was. */
  async remove(caller: Caller, viewId: string): Promise<{ items: ViewView[] }> {
    const { actor, row } = await this._openToEdit(caller, viewId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.views.remove(tx, row.id)
      await this._audit(tx, actor, row, 'deleted', { name: { before: row.name, after: null } })
    })
    return await this.list(caller, row.spaceId ?? undefined)
  }

  /** A personal view is its owner's alone; a space's opens for whoever reads the space. 404 otherwise. */
  private async _open(caller: Caller, viewId: string): Promise<Opened> {
    const actor = await this.deps.gate.actorOf(caller)
    const row = await this.deps.views.find(actor.organizationId, viewId)
    const personal = row?.scope === 'personal'
    if (!row || (personal && row.ownerId !== actor.id)) {
      throw new NotFoundException('View', viewId)
    }
    if (!personal && row.spaceId) {
      await this.deps.gate.check(caller, row.spaceId, 'space:read')
    }
    return { actor, row, canEdit: await this._canEdit(actor, row) }
  }

  private async _openToEdit(caller: Caller, viewId: string): Promise<Opened> {
    const opened = await this._open(caller, viewId)
    if (!opened.canEdit) {
      throw new ForbiddenException(`Only the owner or a space admin may change view "${opened.row.name}"`, { viewId })
    }
    return opened
  }

  private async _canEdit(actor: MemberRow, row: ViewWithOwner): Promise<boolean> {
    if (row.ownerId === actor.id) {
      return true
    }
    return row.spaceId !== null && can(await this.deps.access.forSpace(actor, row.spaceId), 'space:manage')
  }

  private async _audit(
    tx: Database,
    actor: MemberRow,
    row: { id: string; spaceId: string | null },
    action: string,
    changes: Changes
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: row.spaceId,
      actorId: actor.id,
      entityType: 'saved_view',
      entityId: row.id,
      action,
      changes
    })
  }
}

/** JSON fields compare by content: the same filter sent again is no change. */
const _changes = (row: ViewWithOwner, fields: Record<string, unknown>): Changes => {
  const before = row as unknown as Record<string, unknown>
  const changed = Object.entries(fields).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value))
  return diff(before, Object.fromEntries(changed))
}
