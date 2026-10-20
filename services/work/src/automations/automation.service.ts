import { type Clock, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import type { AuditTrail } from '../audit/audit.js'
import { type Changes, diff } from '../audit/audit.js'
import type { CardRules } from '../cards/card-rules.js'
import type { SlackService } from '../integrations/slack.service.js'
import type { Gate, SpaceGate } from '../spaces/space-gate.js'
import type { AutomationRepository, AutomationWithOwner } from './automation.repository.js'
import { type Action, type AutomationInput, toAutomationView, toRunView } from './schemas.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  gate: SpaceGate
  rules: CardRules
  slack: SlackService
  automations: AutomationRepository
}

/**
 * A space's automations (escopo-mvp 4.2): everyone who reads the space sees them and their runs; its
 * admins make, change and remove them. A rule may only reach a space where its maker can write, and every
 * state, type and channel it names must exist where it points — checked here, and again on each run.
 */
export class AutomationService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, spaceId: string) {
    await this.deps.gate.check(caller, spaceId, 'space:read')
    const rows = await this.deps.automations.list(spaceId)
    return { items: rows.map((row) => toAutomationView(row, row.ownerName)) }
  }

  async create(caller: Caller, spaceId: string, input: AutomationInput) {
    const gate = await this.deps.gate.checkWritable(caller, spaceId, 'space:manage')
    await this._assertReachable(caller, gate, input)
    const now = this.deps.clock.now()
    const row = {
      id: this.deps.ids.next(),
      organizationId: gate.actor.organizationId,
      spaceId,
      ownerId: gate.actor.id,
      ...input,
      createdAt: now,
      updatedAt: now
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.automations.insert(tx, row)
      await this._audit(tx, gate, row.id, 'created', diff({}, { name: input.name, enabled: input.enabled }))
    })
    return toAutomationView(row, gate.actor.name)
  }

  /** The editor sends the whole rule; whoever saves it becomes its owner, so its reach is theirs. */
  async update(caller: Caller, automationId: string, input: AutomationInput) {
    const { gate, row } = await this._open(caller, automationId)
    await this._assertReachable(caller, gate, input)
    const fields = { ...input, ownerId: gate.actor.id, updatedAt: this.deps.clock.now() }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.automations.update(tx, row.id, fields)
      await this._audit(
        tx,
        gate,
        row.id,
        'updated',
        diff({ name: row.name, enabled: row.enabled }, { name: input.name, enabled: input.enabled })
      )
    })
    return toAutomationView({ ...row, ...fields }, gate.actor.name)
  }

  async remove(caller: Caller, automationId: string) {
    const { gate, row } = await this._open(caller, automationId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.automations.delete(tx, row.id)
      await this._audit(tx, gate, row.id, 'deleted', { name: { before: row.name, after: null } })
    })
    return await this.list(caller, row.spaceId)
  }

  async runs(caller: Caller, automationId: string) {
    const actor = await this.deps.gate.actorOf(caller)
    const row = await this._find(actor.organizationId, automationId)
    await this.deps.gate.check(caller, row.spaceId, 'space:read')
    return { items: (await this.deps.automations.runs(row.id, 20)).map(toRunView) }
  }

  private async _open(caller: Caller, automationId: string): Promise<{ gate: Gate; row: AutomationWithOwner }> {
    const actor = await this.deps.gate.actorOf(caller)
    const row = await this._find(actor.organizationId, automationId)
    return { gate: await this.deps.gate.checkWritable(caller, row.spaceId, 'space:manage'), row }
  }

  private async _find(organizationId: string, automationId: string): Promise<AutomationWithOwner> {
    const row = await this.deps.automations.find(organizationId, automationId)
    if (!row) {
      throw new NotFoundException('Automation', automationId)
    }
    return row
  }

  /** Every place the rule points at exists, and the caller may write there. */
  private async _assertReachable(caller: Caller, gate: Gate, input: AutomationInput): Promise<void> {
    if (input.trigger.type === 'state_changed' && input.trigger.toStateId) {
      await this.deps.rules.placement(gate.space.id, undefined, input.trigger.toStateId)
    }
    for (const action of input.actions) {
      await this._assertAction(caller, gate, action)
    }
  }

  private async _assertAction(caller: Caller, gate: Gate, action: Action): Promise<void> {
    if (action.type === 'create_card' || action.type === 'move_linked') {
      await this.deps.gate.checkWritable(caller, action.spaceId, 'space:write')
      await this.deps.rules.placement(
        action.spaceId,
        action.type === 'create_card' ? action.typeId : undefined,
        action.stateId
      )
    } else if (action.type === 'set_state') {
      await this.deps.rules.placement(gate.space.id, undefined, action.stateId)
    } else if (action.type === 'slack') {
      const channels = await this.deps.slack.list(caller)
      if (!channels.items.some((channel) => channel.id === action.channelId)) {
        throw new NotFoundException('Slack channel', action.channelId)
      }
    }
  }

  private async _audit(tx: Database, gate: Gate, id: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'automation',
      entityId: id,
      action,
      changes
    })
  }
}
