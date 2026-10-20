import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { CardService } from '../cards/card.service.js'
import type { CardRules } from '../cards/card-rules.js'
import type { FieldRepository } from '../cards/field.repository.js'
import { type FieldView, toFieldView } from '../cards/field.schemas.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import { cardFromAnswers, toCreateCard } from './answers.js'
import type { FormRepository } from './form.repository.js'
import {
  type FormInput,
  type FormQuestion,
  type FormQuestionView,
  type FormRow,
  type FormView,
  PRIORITY_OPTIONS,
  questionsOf,
  toFormView
} from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  rules: CardRules
  fields: FieldRepository
  cards: CardService
  forms: FormRepository
}

/**
 * Intake forms (escopo-mvp 4.1). A space's admins build them; anyone who reads the space — all of
 * LET’S — opens one by its link and sends it, and the answer arrives as a card with the form's labels.
 * This is what replaces the REQ's Jira form (label `business-form`).
 */
export class FormService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string): Promise<{ items: FormView[] }> {
    const gate = await this.deps.gate.check(caller, spaceId, 'space:read')
    const rows = await this.deps.forms.list(spaceId)
    const fields = await this._fields(spaceId)
    return { items: rows.map((row) => this._view(row, gate, fields)) }
  }

  async read(caller: Caller, formId: string): Promise<FormView> {
    const { gate, row } = await this._open(caller, formId, 'space:read')
    return this._view(row, gate, await this._fields(row.spaceId))
  }

  async create(caller: Caller, spaceId: string, input: FormInput): Promise<FormView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const fields = await this._assertValid(spaceId, input)
    const now = this.deps.clock.now()
    const row: FormRow = {
      id: this.deps.ids.next(),
      organizationId: gate.actor.organizationId,
      spaceId,
      ..._columns(input),
      createdAt: now,
      updatedAt: now
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.forms.insert(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, { name: input.name }))
    })
    return this._view(row, gate, fields)
  }

  async update(caller: Caller, formId: string, input: FormInput): Promise<FormView> {
    const { gate, row } = await this._open(caller, formId, 'space:manage')
    const fields = await this._assertValid(row.spaceId, input)
    const next: FormRow = { ...row, ..._columns(input), updatedAt: this.deps.clock.now() }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.forms.update(tx, row.id, next)
      await this._audit(
        tx,
        gate,
        row.id,
        'updated',
        diff({ name: row.name, enabled: row.enabled }, { name: next.name, enabled: next.enabled })
      )
    })
    return this._view(next, gate, fields)
  }

  async remove(caller: Caller, formId: string): Promise<{ items: FormView[] }> {
    const { gate, row } = await this._open(caller, formId, 'space:manage')
    await this.deps.db.transaction(async (tx) => {
      await this.deps.forms.delete(tx, row.id)
      await this._audit(tx, gate, row.id, 'deleted', { name: { before: row.name, after: null } })
    })
    return await this.list(caller, row.spaceId)
  }

  /** One answer, one card: the sender is its reporter, and the form's labels come with it. */
  async submit(caller: Caller, formId: string, answers: Record<string, unknown>) {
    const { row } = await this._open(caller, formId, 'space:read')
    if (!row.enabled) {
      throw new ConflictException(`Form "${row.name}" is not taking answers`, { formId })
    }
    const card = cardFromAnswers(questionsOf(row), answers)
    const created = await this.deps.cards.createFromForm(
      caller,
      row.spaceId,
      toCreateCard(card, { typeId: row.typeId, stateId: row.stateId, labels: row.labels as string[] }),
      {
        dueDate: card.dueDate,
        customFields: card.customFields,
        formId: row.id
      }
    )
    return { card: { id: created.id, key: created.key, title: created.title } }
  }

  private async _open(caller: Caller, formId: string, action: 'space:read' | 'space:manage') {
    const actor = await this.deps.gate.actorOf(caller)
    const row = await this.deps.forms.find(actor.organizationId, formId)
    if (!row) {
      throw new NotFoundException('Form', formId)
    }
    const gate =
      action === 'space:read'
        ? await this.deps.gate.check(caller, row.spaceId, action)
        : await this.deps.gate.checkWritable(caller, row.spaceId, action)
    return { gate, row }
  }

  private async _fields(spaceId: string): Promise<FieldView[]> {
    return (await this.deps.fields.list(spaceId)).map(toFieldView)
  }

  /** The type and state are the space's, and every custom field a question fills exists there. */
  private async _assertValid(spaceId: string, input: FormInput): Promise<FieldView[]> {
    await this.deps.rules.placement(spaceId, input.typeId, input.stateId ?? undefined)
    const fields = await this._fields(spaceId)
    for (const question of input.questions.filter((each) => each.target.startsWith('field:'))) {
      if (!fields.some((field) => `field:${field.id}` === question.target)) {
        throw new ValidationException(`Question "${question.label}" fills a field this space does not have`, {
          target: question.target
        })
      }
    }
    return fields
  }

  private _view(row: FormRow, gate: Gate, fields: readonly FieldView[]): FormView {
    const space = { id: gate.space.id, key: gate.space.key, name: gate.space.name }
    return toFormView(row, space, (question) => _describe(question, fields))
  }

  private async _audit(tx: Database, gate: Gate, id: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'form',
      entityId: id,
      action,
      changes
    })
  }
}

const _columns = (input: FormInput) => ({
  name: input.name,
  description: input.description,
  typeId: input.typeId,
  stateId: input.stateId,
  labels: input.labels,
  fields: input.questions,
  enabled: input.enabled
})

/** How the screen draws a question, from where its answer goes. */
const _describe = (
  question: FormQuestion,
  fields: readonly FieldView[]
): Pick<FormQuestionView, 'kind' | 'options'> => {
  const standard: Record<string, Pick<FormQuestionView, 'kind' | 'options'>> = {
    title: { kind: 'text', options: [] },
    description: { kind: 'long_text', options: [] },
    priority: { kind: 'priority', options: [...PRIORITY_OPTIONS] },
    dueDate: { kind: 'date', options: [] }
  }
  const field = fields.find((each) => `field:${each.id}` === question.target)
  return (
    standard[question.target] ?? (field ? { kind: field.kind, options: field.options } : { kind: 'text', options: [] })
  )
}
