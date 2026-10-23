import { type Clock, ConflictException, type IdGenerator, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { SystemActors } from '../members/system-actor.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import { addDays, daysBetween, saoPauloDay } from './days.js'
import {
  type CloseSprint,
  type CreateSprint,
  type SprintRow,
  type SprintState,
  type SprintView,
  toSprintView,
  type UpdateSprint
} from './schemas.js'
import type { SprintCard, SprintFields, SprintRepository } from './sprint.repository.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  sprints: SprintRepository
  system: SystemActors
}

/** A first sprint lasts two weeks; the next ones last as long as the one before. */
const FIRST_LENGTH_DAYS = 14

/** What happened to a sprint's cards when it closed. */
type Outcome = { completed: SprintCard[]; carried: SprintCard[] }

const _points = (cards: readonly SprintCard[]): number => cards.reduce((sum, card) => sum + (card.points ?? 0), 0)

/**
 * A space's sprints (escopo-mvp 3.11, ADR-0029): planned in its backlog, one active at a time, closed
 * by hand. Whoever edits the space runs them; every write leaves the space's history.
 */
export class SprintService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string, state?: SprintState): Promise<{ items: SprintView[] }> {
    await this.deps.gate.check(caller, spaceId, 'space:read')
    return { items: (await this.deps.sprints.list(spaceId, state)).map(toSprintView) }
  }

  /** Named and dated after the space's last sprint unless told otherwise. */
  async create(caller: Caller, spaceId: string, input: CreateSprint): Promise<SprintView> {
    const gate = await this._writable(caller, spaceId)
    const id = this.deps.ids.next()
    await this.deps.db.transaction(async (tx) => {
      const row = await this._new(tx, gate, id, input)
      await this.deps.sprints.insert(tx, row)
      await this._audit(
        tx,
        gate,
        id,
        'created',
        diff({}, { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn })
      )
    })
    return await this._view(gate, id)
  }

  async update(caller: Caller, sprintId: string, input: UpdateSprint): Promise<SprintView> {
    const { gate, sprint } = await this._open(caller, sprintId)
    if (sprint.state === 'closed') {
      throw new ConflictException(`Sprint "${sprint.name}" is closed`, { sprintId })
    }
    const fields = _defined(input)
    _assertDates(fields.startsOn ?? sprint.startsOn, fields.endsOn ?? sprint.endsOn)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.sprints.update(tx, sprint.id, fields)
      await this._audit(tx, gate, sprint.id, 'updated', diff(sprint, fields))
    })
    return await this._view(gate, sprint.id)
  }

  /** A planned sprint becomes the active one; what it holds now is what the team committed to. */
  async start(caller: Caller, sprintId: string, input: CreateSprint = {}): Promise<SprintView> {
    const { gate, sprint } = await this._open(caller, sprintId)
    await this._assertStartable(sprint)
    const fields = _defined(input)
    _assertDates(fields.startsOn ?? sprint.startsOn, fields.endsOn ?? sprint.endsOn)
    await this.deps.db.transaction(async (tx) => {
      const committed = (await this.deps.sprints.cardsOf(sprint.id, tx)).filter((card) => card.group !== 'cancelled')
      const started = { ...fields, state: 'active', startedAt: this.deps.clock.now() }
      await this.deps.sprints.update(tx, sprint.id, {
        ...started,
        committedCards: committed.length,
        committedPoints: _points(committed)
      })
      await this._audit(tx, gate, sprint.id, 'started', diff(sprint, { ...fields, state: 'active' }))
    })
    return await this._view(gate, sprint.id)
  }

  /**
   * The active sprint closes: done cards stay in it, open ones go where the person said, and the
   * sprint keeps what was completed and carried. A cancelled card is neither.
   */
  async close(caller: Caller, sprintId: string, input: CloseSprint): Promise<SprintView> {
    const { gate, sprint } = await this._open(caller, sprintId)
    if (sprint.state !== 'active') {
      throw new ConflictException(`Sprint "${sprint.name}" is not active; only the active sprint closes`, { sprintId })
    }
    await this.deps.db.transaction(async (tx) => {
      const outcome = _outcome(await this.deps.sprints.cardsOf(sprint.id, tx))
      const destination = await this._destination(tx, gate, sprint, input)
      await this._carry(tx, gate, sprint, outcome.carried, destination)
      await this.deps.sprints.update(tx, sprint.id, _closing(outcome, this.deps.clock.now()))
      await this._audit(tx, gate, sprint.id, 'closed', {
        state: { before: 'active', after: 'closed' },
        openCardsTo: { before: null, after: destination ?? 'backlog' }
      })
    })
    return await this._view(gate, sprint.id)
  }

  /** Only a planned sprint is deleted; its cards go back to the backlog. */
  async remove(caller: Caller, sprintId: string): Promise<void> {
    const { gate, sprint } = await this._open(caller, sprintId)
    if (sprint.state !== 'planned') {
      throw new ConflictException(`Sprint "${sprint.name}" has started; close it instead`, { sprintId })
    }
    await this.deps.db.transaction(async (tx) => {
      await this._carry(tx, gate, sprint, await this.deps.sprints.cardsOf(sprint.id, tx), null)
      await this.deps.sprints.delete(tx, sprint.id)
      await this._audit(tx, gate, sprint.id, 'deleted', { name: { before: sprint.name, after: null } })
    })
  }

  /** Every morning: an active sprint past its end date is marked late, once, which tells its space's lead. */
  async sweepLate(): Promise<{ late: number }> {
    const late = await this.deps.sprints.late(saoPauloDay(this.deps.clock.now()))
    for (const sprint of late) {
      await this._markLate(sprint)
    }
    return { late: late.length }
  }

  private async _markLate(sprint: SprintRow): Promise<void> {
    const automation = await this.deps.system.automation(sprint.organizationId)
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.sprints.update(tx, sprint.id, { lateNoticeAt: now })
      await this.deps.audit.record(tx, {
        organizationId: sprint.organizationId,
        spaceId: sprint.spaceId,
        actorId: automation.member.id,
        entityType: 'sprint',
        entityId: sprint.id,
        action: 'overdue',
        changes: { endsOn: { before: null, after: sprint.endsOn } }
      })
    })
  }

  private async _new(tx: Database, gate: Gate, id: string, input: CreateSprint): Promise<SprintRow> {
    const number = await this.deps.sprints.nextNumber(tx, gate.space.id)
    const dates = await this._datesAfterLast(gate.space.id)
    const startsOn = input.startsOn ?? dates.startsOn
    const endsOn = input.endsOn ?? addDays(startsOn, dates.length)
    _assertDates(startsOn, endsOn)
    return {
      ..._blank(),
      id,
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      number,
      name: input.name ?? `Sprint ${number}`,
      goal: input.goal ?? '',
      startsOn,
      endsOn,
      createdAt: this.deps.clock.now()
    }
  }

  /** The day after the last sprint ends, for as long as it lasted; today for two weeks, at first. */
  private async _datesAfterLast(spaceId: string): Promise<{ startsOn: string; length: number }> {
    const last = await this.deps.sprints.last(spaceId)
    if (!last) {
      return { startsOn: saoPauloDay(this.deps.clock.now()), length: FIRST_LENGTH_DAYS }
    }
    return { startsOn: addDays(last.endsOn, 1), length: daysBetween(last.startsOn, last.endsOn) }
  }

  /** The sprint the open cards go to: the next planned one, a new one, or none — the backlog. */
  private async _destination(tx: Database, gate: Gate, sprint: SprintRow, input: CloseSprint): Promise<string | null> {
    if (input.openCardsTo === 'backlog') {
      return null
    }
    if (input.openCardsTo === 'new') {
      const id = this.deps.ids.next()
      const row = await this._new(tx, gate, id, {})
      await this.deps.sprints.insert(tx, row)
      await this._audit(
        tx,
        gate,
        id,
        'created',
        diff({}, { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn })
      )
      return id
    }
    const next = (await this.deps.sprints.list(sprint.spaceId, 'planned'))[0]
    if (!next) {
      throw new ConflictException(`Space "${gate.space.key}" has no planned sprint; choose a new one or the backlog`, {
        sprintId: sprint.id
      })
    }
    return next.id
  }

  /** Moves cards out of a sprint, each move a line of the card's history. */
  private async _carry(
    tx: Database,
    gate: Gate,
    sprint: SprintRow,
    moving: readonly SprintCard[],
    to: string | null
  ): Promise<void> {
    await this.deps.sprints.moveCards(
      tx,
      moving.map((card) => card.id),
      to,
      this.deps.clock.now()
    )
    for (const card of moving) {
      await this._audit(tx, gate, card.id, 'updated', { sprintId: { before: sprint.id, after: to } }, 'card')
    }
  }

  private async _assertStartable(sprint: SprintRow): Promise<void> {
    if (sprint.state !== 'planned') {
      throw new ConflictException(`Sprint "${sprint.name}" is not planned; only a planned sprint starts`, {
        sprintId: sprint.id
      })
    }
    const active = (await this.deps.sprints.list(sprint.spaceId, 'active'))[0]
    if (active) {
      throw new ConflictException(`Sprint "${active.name}" is active; close it before starting another`, {
        sprintId: sprint.id
      })
    }
  }

  private async _writable(caller: Caller, spaceId: string): Promise<Gate> {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:write')
    if (!gate.space.usesSprints) {
      throw new ConflictException(`Space "${gate.space.key}" does not use sprints`, { spaceId })
    }
    return gate
  }

  /** The sprint and the right to change it; one in a space the caller cannot read does not exist. */
  private async _open(caller: Caller, sprintId: string): Promise<{ gate: Gate; sprint: SprintRow }> {
    const actor = await this.deps.gate.actorOf(caller)
    const sprint = await this.deps.sprints.find(actor.organizationId, sprintId)
    if (!sprint) {
      throw new NotFoundException('Sprint', sprintId)
    }
    return { gate: await this._writable(caller, sprint.spaceId), sprint }
  }

  private async _view(gate: Gate, sprintId: string): Promise<SprintView> {
    const sprint = await this.deps.sprints.find(gate.actor.organizationId, sprintId)
    if (!sprint) {
      throw new NotFoundException('Sprint', sprintId)
    }
    return toSprintView(sprint)
  }

  private async _audit(
    tx: Database,
    gate: Gate,
    entityId: string,
    action: string,
    changes: Changes,
    entityType: 'sprint' | 'card' = 'sprint'
  ) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType,
      entityId,
      action,
      changes
    })
  }
}

const _outcome = (cards: readonly SprintCard[]): Outcome => ({
  completed: cards.filter((card) => card.group === 'done'),
  carried: cards.filter((card) => card.group !== 'done' && card.group !== 'cancelled')
})

const _closing = ({ completed, carried }: Outcome, at: Date): SprintFields => ({
  state: 'closed',
  closedAt: at,
  completedCards: completed.length,
  completedPoints: _points(completed),
  carriedCards: carried.length,
  carriedPoints: _points(carried)
})

/** The fields that were sent, without the ones left out. */
const _defined = <T extends object>(input: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }

const _assertDates = (startsOn: string, endsOn: string): void => {
  if (daysBetween(startsOn, endsOn) < 0) {
    throw new ValidationException(`A sprint ends on or after it starts: ${startsOn} to ${endsOn}`, { startsOn, endsOn })
  }
}

const _blank = () => ({
  state: 'planned',
  startedAt: null,
  closedAt: null,
  lateNoticeAt: null,
  committedCards: null,
  committedPoints: null,
  completedCards: null,
  completedPoints: null,
  carriedCards: null,
  carriedPoints: null
})
