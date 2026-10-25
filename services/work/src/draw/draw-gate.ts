import { can } from '@jiraia/authorization'
import { ConflictException, ForbiddenException, NotFoundException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { MemberRow } from '../members/schemas.js'
import type { ContentRepository } from './content.repository.js'
import { type ContentRow, isDocument } from './content.schemas.js'
import type { DrawSpaceRepository } from './draw-space.repository.js'
import type { DrawSpaceWithCreator } from './draw-space.schemas.js'

/** Who is calling, the LET’S Draw AI space, and whether they may edit it and change the space itself. */
export type DrawAccess = { actor: MemberRow; space: DrawSpaceWithCreator; canWrite: boolean; canManage: boolean }
export type ContentAccess = { gate: DrawAccess; content: ContentRow }

/** Reading is every member's; writing needs member or admin; managing the space needs admin. */
export type DrawAction = 'read' | 'write' | 'manage'

const ACTION = { read: 'space:read', write: 'space:write', manage: 'space:manage' } as const
const NEEDS = { read: 'a role', write: 'the member or admin role', manage: 'the admin role' } as const

/**
 * "May this caller do this in this LET’S Draw AI space?" (ADR-0012). Every member of the organization
 * reads every space; editing needs a role given to them or to one of their groups. A space of another
 * organization, or deleted, is a 404.
 */
export class DrawGate {
  constructor(
    private readonly deps: { access: AccessResolver; spaces: DrawSpaceRepository; contents: ContentRepository }
  ) {}

  async actorOf(caller: Caller): Promise<MemberRow> {
    return await this.deps.access.actor(caller)
  }

  async space(caller: Caller, spaceId: string, action: DrawAction): Promise<DrawAccess> {
    const actor = await this.actorOf(caller)
    const space = await this.deps.spaces.find(actor.organizationId, spaceId)
    if (!space) {
      throw new NotFoundException('Space', spaceId)
    }
    const access = await this.deps.access.forSpace(actor, space.id, 'draw')
    // A closed wiki collection the caller cannot read does not exist for them (ADR-0034).
    if (!can(access, 'space:read')) {
      throw new NotFoundException('Space', spaceId)
    }
    if (!can(access, ACTION[action])) {
      throw new ForbiddenException(`To ${action} in space "${space.name}" you need ${NEEDS[action]}`, {
        spaceId,
        spaceRole: access.spaceRole ?? null
      })
    }
    return { actor, space, canWrite: can(access, 'space:write'), canManage: can(access, 'space:manage') }
  }

  /** What the member may do in the space, for a listing that shows it beside each one. */
  async rights(
    actor: MemberRow,
    spaceId: string
  ): Promise<{ canRead: boolean; canWrite: boolean; canManage: boolean }> {
    const access = await this.deps.access.forSpace(actor, spaceId, 'draw')
    return {
      canRead: can(access, 'space:read'),
      canWrite: can(access, 'space:write'),
      canManage: can(access, 'space:manage')
    }
  }

  async open(caller: Caller, contentId: string, action: DrawAction): Promise<ContentAccess> {
    const actor = await this.actorOf(caller)
    const content = await this.deps.contents.find(actor.organizationId, contentId)
    if (!content) {
      throw new NotFoundException('Content', contentId)
    }
    const gate = await this.space(caller, content.spaceId, action).catch((error: unknown) => {
      throw error instanceof NotFoundException ? new NotFoundException('Content', contentId) : error
    })
    return { gate, content }
  }

  /** A page or a whiteboard — what has a document to edit, version and comment; a folder has none. */
  async openDocument(caller: Caller, contentId: string, action: DrawAction): Promise<ContentAccess> {
    const access = await this.open(caller, contentId, action)
    if (!isDocument(access.content.kind)) {
      throw new ConflictException(`"${access.content.title}" is a folder; it has no document`, { contentId })
    }
    return access
  }
}
