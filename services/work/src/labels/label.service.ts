import { type Clock, ConflictException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditInput, type AuditTrail, diff } from '../audit/audit.js'
import type { TypeColor } from '../cards/card-type.schemas.js'
import { typeColorSchema } from '../cards/card-type.schemas.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import type { Carrier, LabelRepository } from './label.repository.js'
import { colorOf, type LabelRow, type LabelView } from './label.schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  labels: LabelRepository
}

type Changes = { name?: string | undefined; color?: TypeColor | undefined }

/**
 * A space's labels (ADR-0032): everyone who reads the space reads them; its admins create them, colour
 * them, rename them — joining two when the new name is taken — and remove them from every card. A card
 * that changes because of it says so in its own history.
 */
export class LabelService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string): Promise<{ items: LabelView[] }> {
    await this.deps.gate.check(caller, spaceId, 'space:read')
    return await this._view(spaceId)
  }

  async create(caller: Caller, spaceId: string, input: { name: string; color?: TypeColor | undefined }) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    if (await this.deps.labels.findByName(spaceId, input.name)) {
      throw new ConflictException(`A label named "${input.name}" already exists in this space`, { name: input.name })
    }
    const row: LabelRow = {
      id: this.deps.ids.next(),
      spaceId,
      name: input.name,
      color: input.color ?? colorOf(input.name),
      createdAt: this.deps.clock.now()
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.labels.insert(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, { name: row.name, color: row.color }))
    })
    return await this._view(spaceId)
  }

  async update(caller: Caller, spaceId: string, labelId: string, input: Changes) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const label = await this._label(spaceId, labelId)
    const renamed = input.name !== undefined && input.name !== label.name ? input.name : undefined
    const target = renamed ? await this.deps.labels.findByName(spaceId, renamed) : undefined
    const carriers = renamed ? await this.deps.labels.carriers(spaceId, label.name) : []
    await this.deps.db.transaction(async (tx) => {
      await this._relabel(tx, gate, carriers, label.name, renamed)
      if (target) {
        await this.deps.labels.delete(tx, label.id)
        await this._audit(tx, gate, label.id, 'merged', { name: { before: label.name, after: target.name } })
        return
      }
      const fields = Object.fromEntries(
        Object.entries({ name: renamed, color: input.color }).filter(([, v]) => v !== undefined)
      )
      await this.deps.labels.update(tx, label.id, fields)
      await this._audit(tx, gate, label.id, 'updated', diff(label, fields))
    })
    return await this._view(spaceId)
  }

  /** The label leaves every card of the space, then the catalogue. */
  async remove(caller: Caller, spaceId: string, labelId: string) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const label = await this._label(spaceId, labelId)
    const carriers = await this.deps.labels.carriers(spaceId, label.name)
    await this.deps.db.transaction(async (tx) => {
      await this._relabel(tx, gate, carriers, label.name, undefined)
      await this.deps.labels.delete(tx, label.id)
      await this._audit(tx, gate, label.id, 'deleted', { name: { before: label.name, after: null } })
    })
    return await this._view(spaceId)
  }

  /** Each card swaps `from` for `to` — or loses it — keeping each label once, and records the change. */
  private async _relabel(tx: Database, gate: Gate, carriers: readonly Carrier[], from: string, to: string | undefined) {
    const at = this.deps.clock.now()
    for (const card of carriers) {
      const next = [...new Set(card.labels.flatMap((each) => (each === from ? (to ? [to] : []) : [each])))]
      await this.deps.labels.setCardLabels(tx, card.id, next, at)
      await this.deps.audit.record(tx, {
        organizationId: gate.actor.organizationId,
        spaceId: gate.space.id,
        actorId: gate.actor.id,
        entityType: 'card',
        entityId: card.id,
        action: 'updated',
        changes: { labels: { before: card.labels, after: next } }
      })
    }
  }

  private async _label(spaceId: string, labelId: string): Promise<LabelRow> {
    const label = await this.deps.labels.find(spaceId, labelId)
    if (!label) {
      throw new NotFoundException('Label', labelId)
    }
    return label
  }

  private async _view(spaceId: string): Promise<{ items: LabelView[] }> {
    const rows = await this.deps.labels.list(spaceId)
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: typeColorSchema.parse(row.color),
        cards: row.cards
      }))
    }
  }

  private async _audit(tx: Database, gate: Gate, entityId: string, action: string, changes: AuditInput['changes']) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'label',
      entityId,
      action,
      changes
    })
  }
}
