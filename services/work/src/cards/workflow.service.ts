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

/**
 * Board columns after the states are reordered: each column sits where its first state now is, so a
 * column of one state moves with it; a column holding no state goes last (ADR-0037).
 */
export const columnOrder = (
  columns: readonly { id: string }[],
  states: readonly Pick<StateRow, 'id' | 'columnId'>[],
  stateIds: readonly string[]
): string[] => {
  const columnOf = new Map(states.map((state) => [state.id, state.columnId]))
  const first = (columnId: string) => {
    const at = stateIds.findIndex((id) => columnOf.get(id) === columnId)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  return [...columns].sort((a, b) => first(a.id) - first(b.id)).map((column) => column.id)
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
    const column = input.name === undefined ? undefined : await this._ownColumn(spaceId, state)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.updateState(tx, state.id, fields)
      if (column && input.name !== undefined) {
        await this.deps.workflows.renameColumn(tx, column, input.name)
      }
      await this._audit(tx, gate, state.id, 'updated', diff(state, fields))
    })
    return await this._view(spaceId)
  }

  /** The board column that is only this state, under its name: renaming the state renames it too. */
  private async _ownColumn(spaceId: string, state: StateRow): Promise<string | undefined> {
    const column = (await this.deps.workflows.columns(spaceId)).find(
      (each) => each.id === state.columnId && each.name === state.name
    )
    const states = await this.deps.workflows.states(spaceId)
    return column && states.filter((each) => each.columnId === column.id).length === 1 ? column.id : undefined
  }

  /** The new board order must name every state of the space, once; the board columns follow it. */
  async orderStates(caller: Caller, spaceId: string, stateIds: readonly string[]): Promise<WorkflowView> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    const states = await this.deps.workflows.states(spaceId)
    const current = states.map((state) => state.id)
    if (current.length !== stateIds.length || !current.every((id) => stateIds.includes(id))) {
      throw new ValidationException('The order must list every state of the space exactly once', {
        expected: current.length
      })
    }
    const columns = await this.deps.workflows.columns(spaceId)

    await this.deps.db.transaction(async (tx) => {
      await this.deps.workflows.setOrder(tx, stateIds)
      await this.deps.workflows.setColumnOrder(tx, columnOrder(columns, states, stateIds))
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
