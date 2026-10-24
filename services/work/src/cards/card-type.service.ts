import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditInput, type AuditTrail, diff } from '../audit/audit.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import { lookOf, type TypeColor, type TypeIcon } from './card-type.schemas.js'
import { type CardTypeRow, toStateView, toTypeView, type WorkflowView } from './schemas.js'
import type { WorkflowRepository } from './workflow.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  workflows: WorkflowRepository
}

type Look = { icon?: TypeIcon | undefined; color?: TypeColor | undefined }

/**
 * A space's card types, managed by its admins in the space settings (escopo-mvp 2.1, ADR-0031): a
 * name, an icon and a colour, in the order they are offered. A type is removed by turning everything of
 * it into another type; the last one stays.
 */
export class CardTypeService {
  constructor(private readonly deps: Deps) {}

  async add(caller: Caller, spaceId: string, input: { name: string } & Look): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const types = await this.deps.workflows.types(spaceId)
    this._assertNameFree(types, input.name)
    const look = lookOf(input.name)
    const row: CardTypeRow = {
      id: this.deps.ids.next(),
      spaceId,
      name: input.name,
      icon: input.icon ?? look.icon,
      color: input.color ?? look.color,
      position: types.length,
      createdAt: this.deps.clock.now()
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.insertType(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, { name: row.name, icon: row.icon, color: row.color }))
    })
    return await this._view(spaceId)
  }

  async update(caller: Caller, spaceId: string, typeId: string, input: { name?: string | undefined } & Look) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const type = await this._type(spaceId, typeId)
    if (input.name !== undefined && input.name.toLowerCase() !== type.name.toLowerCase()) {
      this._assertNameFree(await this.deps.workflows.types(spaceId), input.name)
    }
    const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.updateType(tx, type.id, fields)
      await this._audit(tx, gate, type.id, 'updated', diff(type, fields))
    })
    return await this._view(spaceId)
  }

  /** The new order must name every type of the space, once. */
  async order(caller: Caller, spaceId: string, typeIds: readonly string[]): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const current = (await this.deps.workflows.types(spaceId)).map((type) => type.id)
    if (current.length !== typeIds.length || !current.every((id) => typeIds.includes(id))) {
      throw new ValidationException('The order must list every card type of the space exactly once', {
        expected: current.length
      })
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.setTypeOrder(tx, typeIds)
      await this._audit(tx, gate, spaceId, 'reordered', { order: { before: current, after: typeIds } })
    })
    return await this._view(spaceId)
  }

  /** Everything of the type — cards, forms, fields, rules, views — becomes of `moveTo` before it goes. */
  async remove(caller: Caller, spaceId: string, typeId: string, moveTo: string): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const type = await this._type(spaceId, typeId)
    const destination = await this._destination(spaceId, type, moveTo)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.replaceType(tx, type.id, destination.id)
      await this.deps.workflows.deleteType(tx, type.id)
      await this._audit(tx, gate, type.id, 'deleted', { name: { before: type.name, after: null } })
    })
    return await this._view(spaceId)
  }

  private async _destination(spaceId: string, type: CardTypeRow, moveTo: string): Promise<CardTypeRow> {
    const types = await this.deps.workflows.types(spaceId)
    if (types.length === 1) {
      throw new ConflictException('A space keeps at least one card type', { typeId: type.id })
    }
    const destination = types.find((each) => each.id === moveTo && each.id !== type.id)
    if (!destination) {
      throw new ValidationException(`Card type "${moveTo}" is not another type of this space`, { moveTo })
    }
    return destination
  }

  private async _type(spaceId: string, typeId: string): Promise<CardTypeRow> {
    const type = await this.deps.workflows.findType(spaceId, typeId)
    if (!type) {
      throw new NotFoundException('Card type', typeId)
    }
    return type
  }

  private _assertNameFree(types: readonly CardTypeRow[], name: string): void {
    if (types.some((type) => type.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`A card type named "${name}" already exists in this space`, { name })
    }
  }

  private async _view(spaceId: string): Promise<WorkflowView> {
    const [states, types] = await Promise.all([this.deps.workflows.states(spaceId), this.deps.workflows.types(spaceId)])
    return { states: states.map(toStateView), types: types.map(toTypeView) }
  }

  private async _audit(tx: Database, gate: Gate, entityId: string, action: string, changes: AuditInput['changes']) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'card_type',
      entityId,
      action,
      changes
    })
  }
}
