import { can } from '@jiraia/authorization'
import { type Clock, toIso } from '@jiraia/core'

import type { AccessResolver } from '../access.js'
import type { Changes } from '../audit/audit.js'
import type { CardRepository } from '../cards/card.repository.js'
import type { FieldRepository } from '../cards/field.repository.js'
import type { CardWithPeople } from '../cards/schemas.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import type { GroupRepository } from '../groups/group.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { SpaceRepository } from '../spaces/space.repository.js'
import { currentValues, drifted, type FieldValues, itemChanges } from './item-effects.js'
import type { ProposalWithItems } from './proposal.repository.js'
import type { ItemResult } from './proposal-applier.js'
import {
  type ProposalItemInput,
  type ProposalItemRow,
  type ProposalItemView,
  type ProposalStatusView,
  type ProposalView,
  proposalItemInputSchema
} from './schemas.js'

type Deps = {
  clock: Clock
  access: AccessResolver
  spaces: SpaceRepository
  cards: CardRepository
  fields: FieldRepository
  workflows: WorkflowRepository
  groups: GroupRepository
  members: MemberRepository
}

/** What one space lends every proposal in it: its names, and whether the viewer writes there. */
type SpaceContext = { key: string; name: string; names: Map<string, string>; writes: boolean }

/** How a proposal reads: stored `applying` is still pending, a pending one past its date has expired. */
export const statusOf = (row: Pick<ProposalWithItems, 'status' | 'expiresAt'>, now: Date): ProposalStatusView => {
  if (row.status === 'pending' || row.status === 'applying') {
    return row.expiresAt <= now ? 'expired' : 'pending'
  }
  return row.status as ProposalStatusView
}

/** Turns stored proposals into what the panel and the agent read, with names for every id they show. */
export class ProposalViews {
  constructor(private readonly deps: Deps) {}

  async build(actor: MemberRow, rows: readonly ProposalWithItems[]): Promise<ProposalView[]> {
    const [members, groups] = await Promise.all([
      this.deps.members.list(actor.organizationId),
      this.deps.groups.list(actor.organizationId)
    ])
    const people = new Map(members.map((member) => [member.id, member.name]))
    const shared = new Map([...people, ...groups.map((group) => [group.id, group.name] as const)])
    const spaces = new Map<string, Promise<SpaceContext>>()
    const context = (spaceId: string) => {
      if (!spaces.has(spaceId)) {
        spaces.set(spaceId, this._space(actor, spaceId))
      }
      return spaces.get(spaceId) as Promise<SpaceContext>
    }
    return await Promise.all(
      rows.map(async (row) => this._view(actor, row, await context(row.spaceId), { people, shared }))
    )
  }

  private async _space(actor: MemberRow, spaceId: string): Promise<SpaceContext> {
    const [space, states, types, fields, access] = await Promise.all([
      this.deps.spaces.find(actor.organizationId, spaceId),
      this.deps.workflows.states(spaceId),
      this.deps.workflows.types(spaceId),
      this.deps.fields.list(spaceId),
      this.deps.access.forSpace(actor, spaceId)
    ])
    const names = new Map<string, string>([
      ...states.map((each) => [each.id, each.name] as const),
      ...types.map((each) => [each.id, each.name] as const),
      ...fields.map((each) => [each.id, each.name] as const)
    ])
    const writes = actor.kind === 'person' && can(access, 'space:write') && !space?.archivedAt
    return { key: space?.key ?? '', name: space?.name ?? '', names, writes }
  }

  private async _view(
    actor: MemberRow,
    row: ProposalWithItems,
    space: SpaceContext,
    lookups: { people: Map<string, string>; shared: Map<string, string> }
  ): Promise<ProposalView> {
    const status = statusOf(row, this.deps.clock.now())
    const items = await Promise.all(row.items.map((item) => this._item(actor, item, status)))
    const person = (id: string | null) => (id ? { id, name: lookups.people.get(id) ?? '' } : null)
    return {
      id: row.id,
      space: { id: row.spaceId, key: space.key, name: space.name },
      author: { id: row.authorId, name: lookups.people.get(row.authorId) ?? '' },
      reason: row.reason,
      status,
      autoApplied: row.autoApplied,
      decidedBy: person(row.decidedBy),
      decidedAt: row.decidedAt ? toIso(row.decidedAt) : null,
      note: row.note,
      revertedBy: person(row.revertedBy),
      revertedAt: row.revertedAt ? toIso(row.revertedAt) : null,
      expiresAt: toIso(row.expiresAt),
      createdAt: toIso(row.createdAt),
      items,
      names: _referenced(items, new Map([...lookups.shared, ...space.names])),
      canDecide: space.writes && status === 'pending',
      canRevert: space.writes && status === 'applied'
    }
  }

  private async _item(actor: MemberRow, row: ProposalItemRow, status: ProposalStatusView): Promise<ProposalItemView> {
    const proposed = proposalItemInputSchema.parse(row.payload)
    const adjusted = row.adjusted ? proposalItemInputSchema.parse(row.adjusted) : null
    const input = adjusted ?? proposed
    const result = row.result as ItemResult | null
    const cardId = result?.cardId ?? row.cardId
    const card = cardId ? await this.deps.cards.find(actor.organizationId, cardId) : undefined
    return {
      id: row.id,
      position: row.position,
      kind: input.kind,
      status: row.status as ProposalItemView['status'],
      card: card ? { id: card.id, key: `${card.spaceKey}-${card.number}`, title: card.title } : null,
      proposed,
      adjusted,
      changes: itemChanges(input, (result?.previous ?? row.base) as FieldValues),
      conflicts: status === 'pending' ? _conflicts(input, row.base as FieldValues, card) : {},
      error: row.error
    }
  }
}

/** A pending field change whose card no longer holds what the agent saw. */
const _conflicts = (input: ProposalItemInput, base: FieldValues, card: CardWithPeople | undefined): Changes =>
  input.kind === 'update_card' && card ? drifted(base, currentValues(card, input.changes)) : {}

/** Only the names the items show: every string in their changes that is a known id, or a `field:` key. */
const _referenced = (items: readonly ProposalItemView[], names: Map<string, string>): Record<string, string> => {
  const found: Record<string, string> = {}
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && names.has(value)) {
      found[value] = names.get(value) as string
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit)
    }
  }
  for (const item of items) {
    for (const [field, change] of Object.entries({ ...item.changes, ...item.conflicts })) {
      visit(field.replace(/^field:/, ''))
      visit(change)
    }
  }
  return found
}
