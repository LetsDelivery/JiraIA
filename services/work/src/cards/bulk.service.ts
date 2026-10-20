import { type Clock, NotFoundException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import type { CardFields, CardRepository } from './card.repository.js'
import type { CardAccess, CardGate } from './card-gate.js'
import type { CardRules } from './card-rules.js'
import { rankAt } from './ranking.js'
import { type BulkEdit, type CardView, toCardView } from './schemas.js'
import type { WatcherRepository } from './watcher.repository.js'

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  cardGate: CardGate
  rules: CardRules
  cards: CardRepository
  watchers: WatcherRepository
}

/** At most this many labels on a card, as on a single edit. */
const MAX_LABELS = 20

/**
 * One change to many cards (escopo-mvp 3.8). All of them change or none does: every card is opened
 * for writing first, and the writes share one transaction. Each card gets its own line of history.
 */
export class BulkEditService {
  constructor(private readonly deps: Deps) {}

  async edit(caller: Caller, input: BulkEdit): Promise<{ items: CardView[] }> {
    const opened = await Promise.all(input.cardIds.map((id) => this.deps.cardGate.open(caller, id, 'space:write')))
    await this._assertChanges(opened, input.changes)
    const plans = await this._plans(opened, input.changes)
    const now = this.deps.clock.now()

    await this.deps.db.transaction(async (tx) => {
      for (const { access, fields } of plans) {
        await this._write(tx, access, fields, now, input.changes.assigneeId)
      }
    })
    return { items: await this._reread(opened) }
  }

  private async _assertChanges(opened: CardAccess[], changes: BulkEdit['changes']): Promise<void> {
    const [first] = opened
    if (!first) {
      return
    }
    if (changes.stateId && opened.some((each) => each.card.spaceId !== first.card.spaceId)) {
      const keys = opened.map((each) => `${each.card.spaceKey}-${each.card.number}`).join(', ')
      throw new ValidationException(`State "${changes.stateId}" is one space's; cards ${keys} are in several`, changes)
    }
    if (changes.stateId) {
      await this.deps.rules.placement(first.card.spaceId, undefined, changes.stateId)
    }
    if (changes.assigneeId) {
      await this.deps.rules.activeMember(first.gate.actor, changes.assigneeId)
    }
  }

  /** What each card writes; the ones moving state go to the bottom of its column, in the order sent. */
  private async _plans(opened: CardAccess[], changes: BulkEdit['changes']) {
    const column = changes.stateId ? await this.deps.cards.column(changes.stateId) : []
    let bottom = rankAt(
      column.map((each) => each.rank),
      column.length
    ) as number
    return opened.map((access) => {
      const fields = _fields(access.card, changes)
      if (fields.stateId) {
        fields.rank = bottom
        bottom += 1
      }
      return { access, fields }
    })
  }

  private async _write(tx: Database, access: CardAccess, fields: CardFields, now: Date, assigneeId?: string | null) {
    const { gate, card } = access
    const changes = _changes(card, fields)
    if (Object.keys(changes).length === 0) {
      return
    }
    await this.deps.cards.update(tx, card.id, fields, now)
    await this.deps.watchers.add(tx, card.id, assigneeId ? [assigneeId] : [], now)
    await this.deps.cards.touchSpace(tx, card.spaceId, now)
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: card.spaceId,
      actorId: gate.actor.id,
      entityType: 'card',
      entityId: card.id,
      action: 'updated',
      changes
    })
  }

  private async _reread(opened: CardAccess[]): Promise<CardView[]> {
    return await Promise.all(
      opened.map(async ({ gate, card }) => {
        const fresh = await this.deps.cards.find(gate.actor.organizationId, card.id)
        if (!fresh) {
          throw new NotFoundException('Card', card.id)
        }
        return toCardView(fresh)
      })
    )
  }
}

/** The fields one card changes; a state it is already in, or an assignee it already has, is no change. */
const _fields = (card: CardAccess['card'], changes: BulkEdit['changes']): CardFields => {
  const fields: CardFields = {}
  if (changes.stateId && changes.stateId !== card.stateId) {
    fields.stateId = changes.stateId
  }
  if (changes.assigneeId !== undefined && changes.assigneeId !== card.assigneeId) {
    fields.assigneeId = changes.assigneeId
  }
  if (changes.addLabels || changes.removeLabels) {
    fields.labels = labelsAfter(card, changes.addLabels ?? [], changes.removeLabels ?? [])
  }
  return fields
}

/**
 * The card's labels with some taken off and some added, each once, in the order they came.
 *
 * @example labelsAfter({ labels: ['a', 'b'] }, ['c', 'a'], ['b'])   // ['a', 'c']
 */
export const labelsAfter = (
  card: Pick<CardAccess['card'], 'labels' | 'spaceKey' | 'number'>,
  add: readonly string[],
  remove: readonly string[]
): string[] => {
  const kept = (card.labels as string[]).filter((label) => !remove.includes(label))
  const labels = [...new Set([...kept, ...add])]
  if (labels.length > MAX_LABELS) {
    throw new ValidationException(`Card "${card.spaceKey}-${card.number}" would have ${labels.length} labels`, {
      max: MAX_LABELS
    })
  }
  return labels
}

/** Field by field, without the rank (ordering is no change to the card) and labels compared by content. */
const _changes = (card: CardAccess['card'], fields: CardFields): Changes => {
  const { rank: _rank, ...visible } = fields
  const changes = diff(card as unknown as Record<string, unknown>, visible as Record<string, unknown>)
  if (visible.labels && JSON.stringify(visible.labels) === JSON.stringify(card.labels)) {
    delete changes.labels
  }
  return changes
}
