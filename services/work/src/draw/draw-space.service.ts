import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { assertCreatesSpaces } from '../access.js'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { DrawAccess, DrawGate } from './draw-gate.js'
import type { DrawSpaceRepository } from './draw-space.repository.js'
import {
  type CreateDrawSpace,
  type DrawMark,
  type DrawSpaceView,
  toDrawSpaceView,
  type UpdateDrawSpace
} from './draw-space.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  drawGate: DrawGate
  spaces: DrawSpaceRepository
}

/**
 * LET’S Draw AI's spaces (ADR-0011, ADR-0012): organization admins and space managers create them, and
 * whoever creates one becomes its admin. The whole organization reads it; its members and admins edit it; its admins rename and
 * delete it and give roles in it.
 */
export class DrawSpaceService {
  constructor(private readonly deps: Deps) {}

  /** Every space, starred first, then by name. */
  async list(caller: Caller): Promise<{ items: DrawSpaceView[] }> {
    const actor = await this.deps.drawGate.actorOf(caller)
    const [rows, marks] = await Promise.all([
      this.deps.spaces.list(actor.organizationId),
      this.deps.spaces.marksOf(actor.id)
    ])
    const views = await Promise.all(
      rows.map(async (row) =>
        toDrawSpaceView(row, marks.get(row.id) ?? new Set(), await this.deps.drawGate.rights(actor, row.id))
      )
    )
    return { items: views.sort((a, b) => Number(b.starred) - Number(a.starred)) }
  }

  async create(caller: Caller, input: CreateDrawSpace): Promise<DrawSpaceView> {
    const actor = await this.deps.drawGate.actorOf(caller)
    assertCreatesSpaces(actor)
    const id = this.deps.ids.next()
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.insert(tx, {
        id,
        organizationId: actor.organizationId,
        ...input,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      })
      await this.deps.spaces.addAdmin(tx, id, actor.id, now)
      await this._audit(
        tx,
        { actorId: actor.id, organizationId: actor.organizationId, spaceId: id },
        'created',
        diff({}, { name: input.name, admin: actor.id })
      )
    })
    return await this.read(caller, id)
  }

  async read(caller: Caller, spaceId: string): Promise<DrawSpaceView> {
    const gate = await this.deps.drawGate.space(caller, spaceId, 'read')
    return await this._view(gate)
  }

  async update(caller: Caller, spaceId: string, input: UpdateDrawSpace): Promise<DrawSpaceView> {
    const gate = await this.deps.drawGate.space(caller, spaceId, 'manage')
    const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, spaceId, fields, this.deps.clock.now())
      await this._audit(tx, _who(gate), 'updated', diff(gate.space as unknown as Record<string, unknown>, fields))
    })
    return await this.read(caller, spaceId)
  }

  /** Deleting hides the space and everything in it; the rows and their history stay. */
  async remove(caller: Caller, spaceId: string): Promise<{ items: DrawSpaceView[] }> {
    const gate = await this.deps.drawGate.space(caller, spaceId, 'manage')
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.spaces.update(tx, spaceId, { deletedAt: now }, now)
      await this._audit(tx, _who(gate), 'deleted', { name: { before: gate.space.name, after: null } })
    })
    return await this.list(caller)
  }

  /** A star or a follow is the member's own: not audited, as a JiraIA star. */
  async mark(caller: Caller, spaceId: string, mark: DrawMark, on: boolean): Promise<DrawSpaceView> {
    const gate = await this.deps.drawGate.space(caller, spaceId, 'read')
    if (on) {
      await this.deps.spaces.mark({ spaceId, memberId: gate.actor.id, mark, createdAt: this.deps.clock.now() })
    } else {
      await this.deps.spaces.unmark(spaceId, gate.actor.id, mark)
    }
    return await this._view(gate)
  }

  private async _view(gate: DrawAccess): Promise<DrawSpaceView> {
    const marks = await this.deps.spaces.marksOf(gate.actor.id)
    return toDrawSpaceView(gate.space, marks.get(gate.space.id) ?? new Set(), gate)
  }

  private async _audit(tx: Database, who: Who, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: who.organizationId,
      spaceId: who.spaceId,
      actorId: who.actorId,
      entityType: 'draw_space',
      entityId: who.spaceId,
      action,
      changes
    })
  }
}

type Who = { actorId: string; organizationId: string; spaceId: string }
const _who = (gate: DrawAccess): Who => ({
  actorId: gate.actor.id,
  organizationId: gate.actor.organizationId,
  spaceId: gate.space.id
})
