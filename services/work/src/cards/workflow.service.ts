import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditInput, type AuditTrail, diff } from '../audit/audit.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import type { StateGroup, StateRow, WorkflowView } from './schemas.js'
import type { WorkflowRepository } from './workflow.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  workflows: WorkflowRepository
}

/** A space's workflow, configured by its admins without code (escopo-mvp 2.1, 2.2, 2.3). */
export class WorkflowService {
  constructor(private readonly deps: Deps) {}

  async get(caller: Caller, spaceId: string): Promise<WorkflowView> {
    await this.deps.gate.check(caller, spaceId, 'space:read')

    return await this._view(spaceId)
  }

  /** In a space with board columns, a new state gets a column of its own, so it does not leave the board. */
  async addState(caller: Caller, spaceId: string, input: { name: string; group: StateGroup }): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const states = await this.deps.workflows.states(spaceId)
    this._assertNameFree(states, input.name)
    const columns = await this.deps.workflows.columns(spaceId)
    const at = this.deps.clock.now()
    const column =
      columns.length > 0
        ? { id: this.deps.ids.next(), spaceId, name: input.name, position: columns.length, createdAt: at }
        : undefined
    const row: StateRow = {
      id: this.deps.ids.next(),
      spaceId,
      ...input,
      position: states.length,
      columnId: column?.id ?? null,
      createdAt: at
    }

    await this.deps.db.transaction(async (tx) => {
      if (column) {
        await this.deps.workflows.insertColumn(tx, column)
      }
      await this.deps.workflows.insertState(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, input))
    })
    return await this._view(spaceId)
  }

  async updateState(
    caller: Caller,
    spaceId: string,
    stateId: string,
    input: { name?: string | undefined; group?: StateGroup | undefined }
  ) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const state = await this._state(spaceId, stateId)
    if (input.name !== undefined && input.name !== state.name) {
      this._assertNameFree(await this.deps.workflows.states(spaceId), input.name)
    }
    const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))

    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.updateState(tx, state.id, fields)
      await this._audit(tx, gate, state.id, 'updated', diff(state, fields))
    })
    return await this._view(spaceId)
  }

  /** The new board order must name every state of the space, once. */
  async orderStates(caller: Caller, spaceId: string, stateIds: readonly string[]): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const current = (await this.deps.workflows.states(spaceId)).map((state) => state.id)
    if (current.length !== stateIds.length || !current.every((id) => stateIds.includes(id))) {
      throw new ValidationException('The order must list every state of the space exactly once', {
        expected: current.length
      })
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.setOrder(tx, stateIds)
      await this._audit(tx, gate, spaceId, 'reordered', { order: { before: current, after: stateIds } })
    })
    return await this._view(spaceId)
  }

  /** A state that still holds cards is removed by moving them to `moveTo` first; the last state stays. */
  async deleteState(caller: Caller, spaceId: string, stateId: string, moveTo?: string): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const state = await this._state(spaceId, stateId)
    const destination = await this._destination(spaceId, state, moveTo)

    await this.deps.db.transaction(async (tx) => {
      if (destination) {
        await this.deps.workflows.moveAllCards(tx, state.id, destination.id)
      }
      await this.deps.workflows.deleteState(tx, state.id)
      await this._audit(tx, gate, state.id, 'deleted', { name: { before: state.name, after: null } })
    })
    return await this._view(spaceId)
  }

  private async _destination(spaceId: string, state: StateRow, moveTo?: string): Promise<StateRow | undefined> {
    const states = await this.deps.workflows.states(spaceId)
    if (states.length === 1) {
      throw new ConflictException('A space keeps at least one state', { stateId: state.id })
    }
    if ((await this.deps.workflows.cardsIn(state.id)) === 0) {
      return undefined
    }
    const destination = states.find((each) => each.id === moveTo && each.id !== state.id)
    if (!destination) {
      throw new ConflictException(`State "${state.name}" still holds cards; say where they go (moveTo)`, {
        stateId: state.id
      })
    }
    return destination
  }

  private async _state(spaceId: string, stateId: string): Promise<StateRow> {
    const state = await this.deps.workflows.findState(spaceId, stateId)
    if (!state) {
      throw new NotFoundException('State', stateId)
    }
    return state
  }

  private _assertNameFree(states: readonly StateRow[], name: string): void {
    if (states.some((state) => state.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`A state named "${name}" already exists in this space`, { name })
    }
  }

  private async _view(spaceId: string): Promise<WorkflowView> {
    return await this.deps.workflows.view(spaceId)
  }

  private async _audit(tx: Database, gate: Gate, entityId: string, action: string, changes: AuditInput['changes']) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'workflow_state',
      entityId,
      action,
      changes
    })
  }
}
