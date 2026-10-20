import { can } from '@jiraia/authorization'
import { type Clock, NotFoundException, toIso } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { SpaceWithLead } from '../spaces/schemas.js'
import { toSpaceView } from '../spaces/schemas.js'
import type { SpaceRepository } from '../spaces/space.repository.js'
import type { PersonalRepository } from './personal.repository.js'
import type { MySpaces, SpaceSummary } from './schemas.js'

const DAY_MS = 24 * 60 * 60 * 1000
const RECOMMENDATION_WINDOW_DAYS = 30
const RECENT_LIMIT = 8
const RECOMMENDED_LIMIT = 6

type Deps = {
  clock: Clock
  access: AccessResolver
  spaces: SpaceRepository
  personal: PersonalRepository
}

/** `YYYY-MM-DD` in UTC — the day a visit is counted on. */
export const utcDay = (at: Date): string => toIso(at).slice(0, 10)

/** The caller's own view of the spaces: stars, recent visits, recommendations. */
export class PersonalService {
  constructor(private readonly deps: Deps) {}

  async mySpaces(caller: Caller): Promise<MySpaces> {
    const actor = await this.deps.access.actor(caller)
    const readable = await this.deps.spaces.listAll(actor.organizationId, false)
    const since = utcDay(new Date(this.deps.clock.now().getTime() - RECOMMENDATION_WINDOW_DAYS * DAY_MS))
    const [starred, visits, counts] = await Promise.all([
      this.deps.personal.starredSpaceIds(actor.id),
      this.deps.personal.lastVisits(actor.id, 50),
      this.deps.personal.visitCounts(actor.id, since)
    ])
    const lastVisit = new Map(visits.map((visit) => [visit.spaceId, visit.lastVisitedAt]))
    const summaries = readable.map((space) => this._summary(space, starred, lastVisit))

    return {
      starred: summaries.filter((space) => space.starred),
      recent: this._recent(summaries, visits),
      recommended: this._recommended(summaries, counts)
    }
  }

  /** Readable spaces only: a member who loses their role stops seeing a star they left behind. */
  async star(caller: Caller, spaceId: string, starred: boolean): Promise<void> {
    const actor = await this.deps.access.actor(caller)
    const space = await this.deps.spaces.find(actor.organizationId, spaceId)
    if (!space || !can(await this.deps.access.forSpace(actor, space.id), 'space:read')) {
      throw new NotFoundException('Space', spaceId)
    }

    if (starred) {
      await this.deps.personal.star(actor.id, spaceId, this.deps.clock.now())
    } else {
      await this.deps.personal.unstar(actor.id, spaceId)
    }
  }

  private _summary(space: SpaceWithLead, starred: Set<string>, lastVisit: Map<string, Date>): SpaceSummary {
    const visited = lastVisit.get(space.id)

    return { ...toSpaceView(space), starred: starred.has(space.id), lastVisitedAt: visited ? toIso(visited) : null }
  }

  private _recent(summaries: SpaceSummary[], visits: { spaceId: string }[]): SpaceSummary[] {
    const byId = new Map(summaries.map((space) => [space.id, space]))

    return visits.flatMap((visit) => byId.get(visit.spaceId) ?? []).slice(0, RECENT_LIMIT)
  }

  private _recommended(summaries: SpaceSummary[], counts: Map<string, number>): SpaceSummary[] {
    return summaries
      .filter((space) => !space.starred)
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'pt-BR'))
      .slice(0, RECOMMENDED_LIMIT)
  }
}
