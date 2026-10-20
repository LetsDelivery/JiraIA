import { can } from '@jiraia/authorization'
import { type Clock, NotFoundException, toIso, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { z } from 'zod'

import type { AuditTrail } from '../audit/audit.js'
import type { MemberRow } from '../members/schemas.js'
import type { SpaceGate } from '../spaces/space-gate.js'
import type { ViewRepository } from '../views/view.repository.js'
import type { ViewWithOwner } from '../views/view.schemas.js'
import type { DashboardRepository, DashboardRow } from './dashboard.repository.js'
import { DEFAULT_WIDGETS } from './defaults.js'
import { type DashboardView, type SaveDashboard, type Widget, widgetSchema } from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  gate: SpaceGate
  dashboards: DashboardRepository
  views: ViewRepository
}

/**
 * A space's dashboard (Etapa 5d, ADR-0016): every reader sees it, its admins save and restore it.
 * A space that never saved one shows `DEFAULT_WIDGETS`.
 */
export class DashboardService {
  constructor(private readonly deps: Deps) {}

  async read(caller: Caller, spaceId: string): Promise<DashboardView> {
    const { actor, access } = await this.deps.gate.check(caller, spaceId, 'space:read')
    const row = await this.deps.dashboards.find(actor.organizationId, spaceId)
    return _view(spaceId, row, can(access, 'space:manage'))
  }

  async save(caller: Caller, spaceId: string, input: SaveDashboard): Promise<DashboardView> {
    const { actor } = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    await this._checkViews(actor, spaceId, input.widgets)
    const before = await this._widgets(actor, spaceId)
    const row = { spaceId, organizationId: actor.organizationId, widgets: input.widgets, updatedBy: actor.id }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.dashboards.save(tx, { ...row, updatedAt: this.deps.clock.now() })
      await this._audit(tx, actor, spaceId, before, input.widgets)
    })
    return await this.read(caller, spaceId)
  }

  /** Back to the default dashboard: the saved one is dropped, and the drop is audited. */
  async restore(caller: Caller, spaceId: string): Promise<DashboardView> {
    const { actor } = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const before = await this._widgets(actor, spaceId)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.dashboards.remove(tx, spaceId)
      await this._audit(tx, actor, spaceId, before, [...DEFAULT_WIDGETS])
    })
    return await this.read(caller, spaceId)
  }

  private async _widgets(actor: MemberRow, spaceId: string): Promise<Widget[]> {
    return _view(spaceId, await this.deps.dashboards.find(actor.organizationId, spaceId), false).widgets
  }

  /** A widget may narrow its cards only by a view shared with the same space, so every reader sees the same. */
  private async _checkViews(actor: MemberRow, spaceId: string, widgets: Widget[]): Promise<void> {
    const viewIds = [...new Set(widgets.flatMap((each) => (each.viewId ? [each.viewId] : [])))]
    for (const viewId of viewIds) {
      const view = await this.deps.views.find(actor.organizationId, viewId)
      if (!isSpaceView(view, spaceId)) {
        throw new ValidationException(`View "${viewId}" is not a view shared with space "${spaceId}"`, { viewId })
      }
    }
  }

  private async _audit(tx: Database, actor: MemberRow, spaceId: string, before: Widget[], after: Widget[]) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId,
      actorId: actor.id,
      entityType: 'dashboard',
      entityId: spaceId,
      action: 'updated',
      changes: { widgets: { before, after } }
    })
  }
}

export const isSpaceView = (view: ViewWithOwner | undefined, spaceId: string): view is ViewWithOwner =>
  view?.scope === 'space' && view.spaceId === spaceId

/** The view a widget names, or 404 when it was deleted or is not the space's. */
export const spaceViewOrFail = (view: ViewWithOwner | undefined, spaceId: string, viewId: string): ViewWithOwner => {
  if (!isSpaceView(view, spaceId)) {
    throw new NotFoundException('View', viewId)
  }
  return view
}

const _view = (spaceId: string, row: DashboardRow | undefined, canEdit: boolean): DashboardView => ({
  spaceId,
  widgets: row ? z.array(widgetSchema).parse(row.widgets) : [...DEFAULT_WIDGETS],
  isDefault: !row,
  canEdit,
  updatedAt: row ? toIso(row.updatedAt) : null
})
