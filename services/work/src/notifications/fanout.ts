import type { Clock, IdGenerator } from '@jiraia/core'

import type { CardRepository } from '../cards/card.repository.js'
import type { CommentRepository } from '../cards/comment.repository.js'
import type { CardWithPeople } from '../cards/schemas.js'
import type { WatcherRepository } from '../cards/watcher.repository.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import { type Consumer, type DomainEvent, detailType } from '../events/event.js'
import { ENTITLEMENT_ACTIONS } from '../governance/notices.js'
import type { GrantRepository } from '../grants/grant.repository.js'
import type { GroupRepository } from '../groups/group.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { ProposalRepository } from '../proposals/proposal.repository.js'
import type { AccessRequestRepository } from '../requests/request.repository.js'
import type { SpaceRepository } from '../spaces/space.repository.js'
import type { SprintRepository } from '../sprints/sprint.repository.js'
import { cardChanges, trackedFields } from './card-changes.js'
import { DRAW_EVENTS } from './draw-notices.js'
import { excerpt } from './excerpt.js'
import type { NotificationRepository, NotificationWithActor } from './notification.repository.js'
import {
  type CardChange,
  type Channel,
  chosenChannels,
  type NotificationData,
  type NotificationKind
} from './schemas.js'

type Deps = {
  clock: Clock
  ids: IdGenerator
  notifications: NotificationRepository
  members: MemberRepository
  cards: CardRepository
  workflows: WorkflowRepository
  watchers: WatcherRepository
  comments: CommentRepository
  requests: AccessRequestRepository
  grants: GrantRepository
  groups: GroupRepository
  spaces: SpaceRepository
  proposals: ProposalRepository
  sprints: SprintRepository
  /** Who hears about an entitlement request (ADR-0024). */
  entitlements?: { notices(event: DomainEvent): Promise<Notice[]> }
  /** Who hears about a Draw page (Etapa 5f). */
  draw?: { notices(event: DomainEvent): Promise<Notice[]> }
  /** Sends the notices a person asked to get in Slack (Etapa 5e). */
  slack?: { deliver(organizationId: string, notices: readonly NotificationWithActor[]): Promise<void> }
}

/** Who should hear about it, why, and what the notice says. */
export type Notice = {
  memberId: string
  kind: NotificationKind
  cardId: string | null
  spaceId: string | null
  data: NotificationData
}

const CARD_ACTIONS = new Set(['created', 'updated', 'moved', 'commented'])
const REQUEST_ACTIONS = new Set(['requested', 'approved', 'declined'])

/**
 * The notifications consumer (escopo-mvp 4.6). From each event it works out who should know —
 * mentioned, given the card, following it, running the space, or waiting for an answer — and leaves
 * each of them one notice. Never the person who did it; never someone who asked for none.
 */
export class NotificationFanout implements Consumer {
  readonly name = 'notifications'

  constructor(private readonly deps: Deps) {}

  accepts(event: DomainEvent): boolean {
    return (
      (event.entityType === 'card' && CARD_ACTIONS.has(event.action)) ||
      (event.entityType === 'access_request' && REQUEST_ACTIONS.has(event.action)) ||
      (event.entityType === 'proposal' && event.action === 'proposed') ||
      (event.entityType === 'entitlement_request' && ENTITLEMENT_ACTIONS.has(event.action)) ||
      (event.entityType === 'access_review' && event.action === 'opened') ||
      DRAW_EVENTS.has(detailType(event)) ||
      (event.entityType === 'sprint' && event.action === 'overdue')
    )
  }

  async handle(event: DomainEvent): Promise<void> {
    await this._write(event, await this._notices(event))
  }

  private async _notices(event: DomainEvent): Promise<Notice[]> {
    if (event.entityType === 'card') {
      return await this._card(event)
    }
    if (event.entityType === 'sprint') {
      return await this._sprintOverdue(event)
    }
    if (DRAW_EVENTS.has(detailType(event))) {
      return (await this.deps.draw?.notices(event)) ?? []
    }
    if (event.entityType === 'entitlement_request' || event.entityType === 'access_review') {
      return (await this.deps.entitlements?.notices(event)) ?? []
    }
    return event.entityType === 'proposal' ? await this._proposal(event) : await this._request(event)
  }

  private async _card(event: DomainEvent): Promise<Notice[]> {
    const card = await this.deps.cards.find(event.organizationId, event.entityId)
    if (!card) {
      return []
    }
    const base = { cardId: card.id, spaceId: card.spaceId, data: await this._cardData(event, card) }
    const watchers = (await this.deps.watchers.list(card.id)).map((watcher) => watcher.id)
    return [
      ...(await this._commented(event, base, watchers)),
      ..._assigned(event).map((memberId) => ({ ...base, memberId, kind: 'assigned' as const })),
      ..._changed(event, base, watchers)
    ]
  }

  /** What every notice of a card event says: the card, its space, and the fields it changed. */
  private async _cardData(event: DomainEvent, card: CardWithPeople): Promise<NotificationData> {
    const [space, changes] = await Promise.all([
      this.deps.spaces.find(event.organizationId, card.spaceId),
      this._changes(event, card.spaceId)
    ])
    const data = {
      cardKey: `${card.spaceKey}-${card.number}`,
      cardTitle: card.title,
      spaceName: space?.name ?? card.spaceKey
    }
    return changes.length > 0 ? { ...data, changes } : data
  }

  private async _changes(event: DomainEvent, spaceId: string): Promise<CardChange[]> {
    if (trackedFields(event).length === 0) {
      return []
    }
    const [states, members, sprints] = await Promise.all([
      this.deps.workflows.states(spaceId),
      this.deps.members.list(event.organizationId),
      this.deps.sprints.list(spaceId)
    ])
    const names = {
      states: new Map(states.map((state) => [state.id, state.name])),
      members: new Map(members.map((member) => [member.id, member.name])),
      sprints: new Map(sprints.map((sprint) => [sprint.id, sprint.name]))
    }
    return cardChanges(event, names)
  }

  private async _commented(
    event: DomainEvent,
    base: Omit<Notice, 'memberId' | 'kind'>,
    watchers: readonly string[]
  ): Promise<Notice[]> {
    const commentId = event.action === 'commented' ? event.changes.comment?.after : undefined
    const comment = typeof commentId === 'string' ? await this.deps.comments.find(event.entityId, commentId) : undefined
    if (!comment) {
      return []
    }
    const mentioned = (comment.mentions as string[]) ?? []
    const data = { ...base.data, excerpt: await this._excerpt(event.organizationId, comment.body) }
    return [
      ...mentioned.map((memberId) => ({ ...base, data, memberId, kind: 'mentioned' as const })),
      ...watchers
        .filter((id) => !mentioned.includes(id))
        .map((memberId) => ({ ...base, data, memberId, kind: 'commented' as const }))
    ]
  }

  /** A sprint past its end date reaches its space's lead, who decides when it closes (ADR-0029). */
  private async _sprintOverdue(event: DomainEvent): Promise<Notice[]> {
    const [sprint, space] = await Promise.all([
      this.deps.sprints.find(event.organizationId, event.entityId),
      this.deps.spaces.find(event.organizationId, event.spaceId ?? '')
    ])
    if (!sprint || !space?.leadId) {
      return []
    }
    const data = { spaceName: space.name, spaceKey: space.key, sprintName: sprint.name, sprintEndsOn: sprint.endsOn }
    return [{ memberId: space.leadId, kind: 'sprint_overdue', cardId: null, spaceId: space.id, data }]
  }

  /** A request to edit reaches whoever runs the space; the answer reaches who asked. */
  private async _request(event: DomainEvent): Promise<Notice[]> {
    const request = await this.deps.requests.find(event.organizationId, event.entityId)
    if (!request) {
      return []
    }
    const product: 'jiraia' | 'draw' = request.product === 'draw' ? 'draw' : 'jiraia'
    const space = product === 'jiraia' ? await this.deps.spaces.find(event.organizationId, request.spaceId) : undefined
    const data = {
      product,
      spaceName: request.spaceName ?? '',
      status: request.status,
      ...(space ? { spaceKey: space.key } : {})
    }
    const base = { cardId: null, spaceId: request.spaceId, data }
    if (event.action !== 'requested') {
      return [{ ...base, memberId: request.memberId, kind: 'access_decided' }]
    }
    return (await this._admins(product, request.spaceId)).map((memberId) => ({
      ...base,
      memberId,
      kind: 'access_requested' as const
    }))
  }

  /**
   * A proposal still waiting reaches whoever runs its space: its admins and its lead (ADR-0019). One a
   * space let through on arrival asks nothing of anyone.
   */
  private async _proposal(event: DomainEvent): Promise<Notice[]> {
    const [proposal, space] = await Promise.all([
      this.deps.proposals.find(event.organizationId, event.entityId),
      this.deps.spaces.find(event.organizationId, event.spaceId ?? '')
    ])
    if (!proposal || !space) {
      return []
    }
    const data = {
      spaceName: space.name,
      spaceKey: space.key,
      proposalId: proposal.id,
      status: proposal.status,
      excerpt: await this._excerpt(event.organizationId, proposal.reason)
    }
    const base = { cardId: null, spaceId: space.id, data }
    return await this._received(proposal, space, base)
  }

  private async _received(
    proposal: { status: string },
    space: { id: string; leadId: string | null },
    base: Omit<Notice, 'memberId' | 'kind'>
  ): Promise<Notice[]> {
    if (proposal.status !== 'pending') {
      return []
    }
    const admins = await this._admins('jiraia', space.id)
    return [...admins, ...(space.leadId ? [space.leadId] : [])].map((memberId) => ({
      ...base,
      memberId,
      kind: 'proposal_received' as const
    }))
  }

  private async _admins(product: 'jiraia' | 'draw', spaceId: string): Promise<string[]> {
    const [people, groups] = await Promise.all([
      this.deps.grants.people(product, spaceId),
      this.deps.grants.groups(product, spaceId)
    ])
    const viaGroups = await this.deps.groups.membersOf(
      groups.filter((group) => group.role === 'admin').map((group) => group.groupId)
    )
    return [
      ...people.filter((person) => person.role === 'admin').map((person) => person.memberId),
      ...viaGroups.map((member) => member.memberId)
    ]
  }

  private async _excerpt(organizationId: string, body: string): Promise<string> {
    return await excerpt(this.deps.members, organizationId, body)
  }

  /** One notice per person and event, to active people only, minus the actor and who chose none. */
  private async _write(event: DomainEvent, notices: readonly Notice[]): Promise<void> {
    const members = await this.deps.members.list(event.organizationId)
    const people = new Set(
      members.filter((member) => member.kind === 'person' && member.status === 'active').map((member) => member.id)
    )
    const first = notices.filter(
      (notice, index) =>
        notice.memberId !== event.actorId &&
        people.has(notice.memberId) &&
        notices.findIndex((each) => each.memberId === notice.memberId) === index
    )
    const channels = await this._channels(first.map((notice) => notice.memberId))
    const now = this.deps.clock.now()
    const rows = first
      .filter((notice) => _goes(channels, notice, 'in_app'))
      .map((notice) => ({
        id: this.deps.ids.next(),
        organizationId: event.organizationId,
        eventId: event.id,
        actorId: event.actorId,
        ...notice,
        createdAt: now,
        readAt: null,
        snoozedUntil: null,
        archivedAt: null,
        emailedAt: null
      }))
    await this.deps.notifications.insert(rows)
    const actorName = members.find((member) => member.id === event.actorId)?.name ?? ''
    const toSlack = rows.filter((row) => _goes(channels, row, 'slack'))
    await this.deps.slack?.deliver(
      event.organizationId,
      toSlack.map((row) => ({ ...row, actorName }))
    )
  }

  /** Each person's channels for each kind they set; a kind left unset goes by its default. */
  private async _channels(memberIds: readonly string[]): Promise<Map<string, unknown>> {
    const preferences = await this.deps.notifications.preferences(memberIds)
    return new Map(preferences.map((each) => [`${each.memberId}:${each.kind}`, each.channels]))
  }
}

/** Whether a person's notice of this kind goes by this channel: their choice, or the kind's default. */
const _goes = (
  channels: ReadonlyMap<string, unknown>,
  notice: { memberId: string; kind: string },
  channel: Channel
): boolean =>
  chosenChannels(notice.kind as NotificationKind, channels.get(`${notice.memberId}:${notice.kind}`)).includes(channel)

/**
 * Watchers hear about the fields that changed: a move as `state_changed` — its own preference, as
 * before Etapa 5f — and any other tracked field as `card_updated`.
 */
const _changed = (
  event: DomainEvent,
  base: Omit<Notice, 'memberId' | 'kind'>,
  watchers: readonly string[]
): Notice[] => {
  const changes = base.data.changes ?? []
  if (changes.length === 0) {
    return []
  }
  const moved = trackedFields(event).includes('stateId')
  const data = moved ? { ...base.data, stateName: String(changes[0]?.after ?? '') } : base.data
  const kind = moved ? ('state_changed' as const) : ('card_updated' as const)
  return watchers.map((memberId) => ({ ...base, data, memberId, kind }))
}

/** Who was given the card by this event — on creation or by a change, as the trail recorded it. */
const _assigned = (event: DomainEvent): string[] => {
  const after = event.changes.assigneeId?.after
  return typeof after === 'string' ? [after] : []
}
