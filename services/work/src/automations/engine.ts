import { can } from '@jiraia/authorization'
import type { Clock, IdGenerator } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import type { CardRepository } from '../cards/card.repository.js'
import { stateGroupSchema, toCardView } from '../cards/schemas.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import type { Consumer, DomainEvent } from '../events/event.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { SystemActors } from '../members/system-actor.js'
import type { ActionRunner } from './actions.js'
import type { AutomationRepository, AutomationWithOwner } from './automation.repository.js'
import { allHold, type StateGroups, triggers } from './rules.js'
import { type AutomationView, type RunStep, toAutomationView } from './schemas.js'

type Deps = {
  clock: Clock
  ids: IdGenerator
  logger: JiraiaLogger
  automations: AutomationRepository
  cards: CardRepository
  workflows: WorkflowRepository
  members: MemberRepository
  access: AccessResolver
  system: SystemActors
  actions: ActionRunner
}

/** The card events a rule can wait for. */
const WATCHED = new Set(['created', 'updated', 'moved'])

type Outcome = { status: 'succeeded' | 'failed' | 'skipped'; steps: RunStep[]; error: string | null }

/**
 * The automation consumer (escopo-mvp 4.2): for each card event of a space, runs the space's rules
 * that wait for it and whose conditions hold, once per rule and event.
 *
 * What an automation itself changes starts no other rule — the MVP's guard against loops (ADR-0014).
 */
export class AutomationEngine implements Consumer {
  readonly name = 'automation'

  constructor(private readonly deps: Deps) {}

  accepts(event: DomainEvent): boolean {
    return event.entityType === 'card' && event.spaceId !== null && WATCHED.has(event.action)
  }

  async handle(event: DomainEvent): Promise<void> {
    const spaceId = event.spaceId as string
    if (await this.deps.system.isAutomation(event.organizationId, event.actorId)) {
      return
    }
    const rules = await this.deps.automations.list(spaceId, true)
    if (rules.length === 0) {
      return
    }
    const groups: StateGroups = new Map(
      (await this.deps.workflows.states(spaceId)).map((state) => [state.id, stateGroupSchema.parse(state.group)])
    )
    for (const row of rules) {
      const rule = toAutomationView(row, row.ownerName)
      if (triggers(rule.trigger, event, groups)) {
        await this._run(row, rule, event)
      }
    }
  }

  private async _run(row: AutomationWithOwner, rule: AutomationView, event: DomainEvent): Promise<void> {
    if (await this.deps.automations.hasRun(rule.id, event.id)) {
      return
    }
    const started = Date.now()
    const outcome = await this._outcome(row, rule, event)
    await this.deps.automations.insertRun({
      id: this.deps.ids.next(),
      automationId: rule.id,
      eventId: event.id,
      cardId: event.entityId,
      ...outcome,
      durationMs: Date.now() - started,
      occurredAt: this.deps.clock.now()
    })
    this.deps.logger.info('Automation ran', { automationId: rule.id, eventId: event.id, status: outcome.status })
  }

  /** A failure is the run's result, not the consumer's: the event is handled, the run says why. */
  private async _outcome(row: AutomationWithOwner, rule: AutomationView, event: DomainEvent): Promise<Outcome> {
    const card = await this.deps.cards.find(event.organizationId, event.entityId)
    if (!card || !allHold(rule.conditions, toCardView(card))) {
      return { status: 'skipped', steps: [], error: null }
    }
    try {
      await this._assertOwnerReaches(row, rule)
      const { caller } = await this.deps.system.automation(event.organizationId)
      const steps = await this.deps.actions.run(rule.actions, toCardView(card), {
        caller,
        organizationId: event.organizationId
      })
      return { status: 'succeeded', steps, error: null }
    } catch (error) {
      return { status: 'failed', steps: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The rule's reach is its owner's: every space it writes in, they must still be able to write in. */
  private async _assertOwnerReaches(row: AutomationWithOwner, rule: AutomationView): Promise<void> {
    const owner = await this.deps.members.findById(row.organizationId, row.ownerId)
    const spaces = new Set([
      rule.spaceId,
      ...rule.actions.flatMap((action) => ('spaceId' in action ? [action.spaceId] : []))
    ])
    for (const spaceId of spaces) {
      const access = owner ? await this.deps.access.forSpace(owner, spaceId) : undefined
      if (!access || !can(access, 'space:write')) {
        throw new Error(`Owner "${row.ownerName}" can no longer write in space "${spaceId}"`)
      }
    }
  }
}
