import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import type { FieldRepository } from './field.repository.js'
import { type CreateField, type FieldRow, toFieldView, type UpdateField } from './field.schemas.js'
import type { WorkflowRepository } from './workflow.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  fields: FieldRepository
  workflows: WorkflowRepository
}

/** The custom fields a space adds to its cards, configured by its admins (escopo-mvp 2.5). */
export class FieldService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string) {
    await this.deps.gate.check(caller, spaceId, 'space:read')
    return { items: (await this.deps.fields.list(spaceId)).map(toFieldView) }
  }

  async create(caller: Caller, spaceId: string, input: CreateField) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const existing = await this.deps.fields.list(spaceId)
    this._assertNameFree(existing, input.name)
    await this._assertTypesBelong(spaceId, input.typeIds)
    const row: FieldRow = {
      id: this.deps.ids.next(),
      spaceId,
      name: input.name,
      kind: input.kind,
      options: [...new Set(input.options)],
      typeIds: input.typeIds,
      position: existing.length,
      createdAt: this.deps.clock.now()
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.fields.insert(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, { name: row.name, kind: row.kind }))
    })
    return toFieldView(row)
  }

  /** An option still chosen on some card cannot be removed: those cards would hold a value nobody offers. */
  async update(caller: Caller, spaceId: string, fieldId: string, input: UpdateField) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const field = await this._field(spaceId, fieldId)
    if (input.name !== undefined && input.name.toLowerCase() !== field.name.toLowerCase()) {
      this._assertNameFree(await this.deps.fields.list(spaceId), input.name)
    }
    await this._assertTypesBelong(spaceId, input.typeIds ?? [])
    if (input.options) {
      await this._assertOptionsUnused(field, input.options)
    }
    const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))

    await this.deps.db.transaction(async (tx) => {
      await this.deps.fields.update(tx, field.id, changes)
      await this._audit(tx, gate, field.id, 'updated', _fieldChanges(field, changes))
    })
    return toFieldView({ ...field, ...changes })
  }

  /** Deleting a field clears its value on every card; the history keeps what each card held. */
  async delete(caller: Caller, spaceId: string, fieldId: string): Promise<void> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const field = await this._field(spaceId, fieldId)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.fields.delete(tx, spaceId, field.id)
      await this._audit(tx, gate, field.id, 'deleted', { name: { before: field.name, after: null } })
    })
  }

  private async _field(spaceId: string, fieldId: string): Promise<FieldRow> {
    const field = await this.deps.fields.find(spaceId, fieldId)
    if (!field) {
      throw new NotFoundException('Field', fieldId)
    }
    return field
  }

  private _assertNameFree(fields: readonly FieldRow[], name: string): void {
    if (fields.some((field) => field.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`A field named "${name}" already exists in this space`, { name })
    }
  }

  private async _assertTypesBelong(spaceId: string, typeIds: readonly string[]): Promise<void> {
    const types = new Set((await this.deps.workflows.types(spaceId)).map((type) => type.id))
    const foreign = typeIds.find((id) => !types.has(id))
    if (foreign) {
      throw new ValidationException(`Card type "${foreign}" is not one of this space`, { typeId: foreign })
    }
  }

  private async _assertOptionsUnused(field: FieldRow, options: readonly string[]): Promise<void> {
    const removed = (field.options as string[]).filter((option) => !options.includes(option))
    for (const option of removed) {
      const total = await this.deps.fields.cardsChoosing(field.spaceId, field.id, option)
      if (total > 0) {
        throw new ConflictException(`Option "${option}" of "${field.name}" is chosen on ${total} cards`, {
          option,
          cards: total
        })
      }
    }
  }

  private async _audit(tx: Database, gate: Gate, fieldId: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'custom_field',
      entityId: fieldId,
      action,
      changes
    })
  }
}

/** Arrays compare by content, so re-sending the same options records nothing. */
const _fieldChanges = (field: FieldRow, changes: Record<string, unknown>): Changes => {
  const before = field as unknown as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(diff(before, changes)).filter(
      ([key, change]) => JSON.stringify(change.after) !== JSON.stringify(before[key])
    )
  )
}
