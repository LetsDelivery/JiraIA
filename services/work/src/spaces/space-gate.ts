import { type Access, type Action, assertCan, can } from '@jiraia/authorization'
import { ConflictException, NotFoundException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { MemberRow } from '../members/schemas.js'
import type { SpaceWithLead } from './schemas.js'
import type { SpaceRepository } from './space.repository.js'

export type Gate = { actor: MemberRow; space: SpaceWithLead; access: Access }

/**
 * "May this caller do X in this space?", asked the same way by everything that lives in a space.
 *
 * 404 before 403: a caller who cannot read a space cannot learn that it exists.
 */
export class SpaceGate {
  constructor(private readonly deps: { access: AccessResolver; spaces: SpaceRepository }) {}

  async actorOf(caller: Caller): Promise<MemberRow> {
    return await this.deps.access.actor(caller)
  }

  async check(caller: Caller, spaceId: string, action: Action): Promise<Gate> {
    const actor = await this.deps.access.actor(caller)
    const space = await this.deps.spaces.find(actor.organizationId, spaceId)
    const access = space ? await this.deps.access.forSpace(actor, space.id) : undefined

    if (!space || !access || !can(access, 'space:read')) {
      throw new NotFoundException('Space', spaceId)
    }
    assertCan(access, action, { spaceId })

    return { actor, space, access }
  }

  /** Writes into an archived space are refused until it is restored. */
  async checkWritable(caller: Caller, spaceId: string, action: Action): Promise<Gate> {
    const gate = await this.check(caller, spaceId, action)
    if (gate.space.archivedAt) {
      throw new ConflictException(`Space "${gate.space.key}" is archived; restore it first`, { spaceId })
    }
    return gate
  }
}
