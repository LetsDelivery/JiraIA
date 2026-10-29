import { type Clock, describeError, type IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { JiraiaLogger } from '@jiraia/logger'

import type { AuditTrail } from '../audit/audit.js'
import type { CardRepository } from '../cards/card.repository.js'
import type { CardService } from '../cards/card.service.js'
import type { CardRow } from '../cards/schemas.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import type { SystemActors } from '../members/system-actor.js'
import type { SpaceRepository } from '../spaces/space.repository.js'
import type { DevLinkRow, GitHubRepository, RefAt } from './github.repository.js'
import {
  type CheckSuiteEvent,
  checksAfter,
  keysOf,
  type PullRequestEvent,
  pullState,
  type RefEvent,
  type ReviewEvent,
  reviewOf
} from './payloads.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  github: GitHubRepository
  cards: CardRepository
  spaces: SpaceRepository
  workflows: WorkflowRepository
  system: SystemActors
  /** Who moves a card when its pull request is merged: the card service, as the GitHub agent. */
  moves: Pick<CardService, 'move'>
  logger: JiraiaLogger
}

/** What GitHub says of a link; the rest of the row is fixed when it is first seen. */
type LinkNews = Partial<
  Pick<DevLinkRow, 'title' | 'url' | 'state' | 'review' | 'checks' | 'author' | 'headSha' | 'mergedAt'>
>

/** The fields whose change is worth a line in the trail: not a title edit or a new commit. */
const TOLD = ['state', 'review', 'checks'] as const

/** Groups a merged card is not moved out of: it was finished or dropped before the merge arrived. */
const SETTLED = new Set(['done', 'cancelled'])

type Scope = { organizationId: string; spaceId: string; actorId: string }

/** A link seen for the first time, with what GitHub said of it. */
const newLink = (at: RefAt, cardId: string, news: LinkNews, id: string, now: Date): DevLinkRow => ({
  id,
  organizationId: at.organizationId,
  cardId,
  repo: at.repo,
  kind: at.kind,
  ref: at.ref,
  title: news.title ?? '',
  url: news.url ?? '',
  state: news.state ?? 'active',
  review: news.review ?? null,
  checks: news.checks ?? null,
  author: news.author ?? '',
  headSha: news.headSha ?? null,
  mergedAt: news.mergedAt ?? null,
  createdAt: now,
  updatedAt: now
})

/** What changed in the fields the trail tells, as `{ before, after }`. */
const toldChanges = (link: DevLinkRow, news: LinkNews) =>
  Object.fromEntries(
    TOLD.filter((field) => field in news && news[field] !== link[field]).map((field) => [
      field,
      { before: link[field], after: news[field] }
    ])
  )

/**
 * What GitHub tells about each card's development (Etapa 9, ADR-0038): the branches and pull requests
 * whose name or title carry its key, their state, review and checks. A pull request merged into the
 * repository's default branch moves its cards to the state their space chose.
 */
export class DevLinkService {
  constructor(private readonly deps: Deps) {}

  async branchCreated(organizationId: string, event: RefEvent): Promise<void> {
    const at: RefAt = { organizationId, repo: event.repository.full_name, kind: 'branch', ref: event.ref }
    const cards = await this._cardsNamed(organizationId, keysOf(event.ref))
    const url = `${event.repository.html_url}/tree/${encodeURI(event.ref)}`
    await this._tell(at, cards, { url, state: 'active', author: event.sender.login })
  }

  async branchDeleted(organizationId: string, event: RefEvent): Promise<void> {
    const at: RefAt = { organizationId, repo: event.repository.full_name, kind: 'branch', ref: event.ref }
    await this._tell(at, [], { state: 'deleted' })
  }

  async pullRequest(organizationId: string, event: PullRequestEvent): Promise<void> {
    const pull = event.pull_request
    const at: RefAt = {
      organizationId,
      repo: event.repository.full_name,
      kind: 'pull_request',
      ref: String(pull.number)
    }
    const state = pullState(pull)
    const cards = await this._cardsNamed(organizationId, keysOf(pull.head.ref, pull.title))
    const linked = await this._tell(at, cards, {
      title: pull.title,
      url: pull.html_url,
      state,
      author: pull.user.login,
      headSha: pull.head.sha,
      mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
      ...(event.action === 'synchronize' ? { checks: null } : {})
    })
    if (event.action === 'closed' && state === 'merged' && pull.base.ref === event.repository.default_branch) {
      await this._moveMerged(organizationId, linked)
    }
  }

  async review(organizationId: string, event: ReviewEvent): Promise<void> {
    const review = reviewOf(event)
    if (review !== undefined) {
      const repo = event.repository.full_name
      const at: RefAt = { organizationId, repo, kind: 'pull_request', ref: String(event.pull_request.number) }
      await this._tell(at, [], { review })
    }
  }

  async checks(organizationId: string, event: CheckSuiteEvent): Promise<void> {
    const repo = event.repository.full_name
    for (const link of await this.deps.github.pullsAtCommit(organizationId, repo, event.check_suite.head_sha)) {
      const checks = checksAfter(event.action, event.check_suite.conclusion, link.checks)
      if (checks) {
        await this._save(link.organizationId, link.cardId, link, { checks })
      }
    }
  }

  /**
   * Tells every card linked to a ref what changed, and links the cards newly named. A card stays linked
   * when its key leaves the title: what happened on that branch is still its history.
   */
  private async _tell(at: RefAt, named: readonly CardRow[], news: LinkNews): Promise<CardRow[]> {
    const known = await this.deps.github.linksAt(at)
    for (const link of known) {
      await this._save(at.organizationId, link.cardId, link, news)
    }
    const fresh = named.filter((card) => !known.some((link) => link.cardId === card.id))
    if (news.url) {
      for (const card of fresh) {
        await this._create(at, card, news)
      }
    }
    const linked = await Promise.all(known.map((link) => this.deps.cards.find(at.organizationId, link.cardId)))
    return [...fresh, ...linked.filter((card): card is NonNullable<typeof card> => card !== undefined)]
  }

  private async _cardsNamed(organizationId: string, keys: readonly string[]): Promise<CardRow[]> {
    const found = await Promise.all(keys.map((key) => this.deps.cards.findByKey(organizationId, key)))
    return found.filter((card): card is NonNullable<typeof card> => card !== undefined)
  }

  private async _create(at: RefAt, card: CardRow, news: LinkNews): Promise<void> {
    const row = newLink(at, card.id, news, this.deps.ids.next(), this.deps.clock.now())
    const { member } = await this.deps.system.github(at.organizationId)
    const scope = { organizationId: at.organizationId, spaceId: card.spaceId, actorId: member.id }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.github.insertLink(tx, row)
      await this._audit(tx, scope, row.id, 'linked', {
        repo: { before: null, after: row.repo },
        ref: { before: null, after: row.ref },
        state: { before: null, after: row.state }
      })
    })
  }

  private async _save(organizationId: string, cardId: string, link: DevLinkRow, news: LinkNews): Promise<void> {
    const changes = toldChanges(link, news)
    const card = await this.deps.cards.find(organizationId, cardId)
    const { member } = await this.deps.system.github(organizationId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.github.updateLink(tx, link.id, { ...news, updatedAt: this.deps.clock.now() })
      if (card && Object.keys(changes).length > 0) {
        await this._audit(
          tx,
          { organizationId, spaceId: card.spaceId, actorId: member.id },
          link.id,
          'updated',
          changes
        )
      }
    })
  }

  /** Each card of a merged pull request goes to its space's chosen state; one refused does not stop the rest. */
  private async _moveMerged(organizationId: string, cards: readonly CardRow[]): Promise<void> {
    const { caller } = await this.deps.system.github(organizationId)
    for (const card of cards) {
      const stateId = await this._mergedState(organizationId, card)
      if (stateId) {
        await this.deps.moves.move(caller, card.id, { stateId, index: 0 }).catch((error: unknown) => {
          this.deps.logger.warn('A merged card was not moved', { cardId: card.id, error: describeError(error) })
        })
      }
    }
  }

  private async _mergedState(organizationId: string, card: CardRow): Promise<string | undefined> {
    const space = await this.deps.spaces.find(organizationId, card.spaceId)
    if (!space?.mergedStateId || space.mergedStateId === card.stateId) {
      return undefined
    }
    const [target, current] = await Promise.all([
      this.deps.workflows.findState(space.id, space.mergedStateId),
      this.deps.workflows.findState(space.id, card.stateId)
    ])
    return target && !SETTLED.has(current?.group ?? '') ? target.id : undefined
  }

  private async _audit(
    tx: Database,
    scope: Scope,
    linkId: string,
    action: string,
    changes: Record<string, { before: unknown; after: unknown }>
  ) {
    await this.deps.audit.record(tx, {
      ...scope,
      entityType: 'dev_link',
      entityId: linkId,
      action,
      changes
    })
  }
}
