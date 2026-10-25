import { type Access, type Role, roleSchema, strongest } from '@jiraia/authorization'
import { ForbiddenException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { and, eq, isNull } from 'drizzle-orm'

import type { MemberAdmission } from './members/admission.js'
import type { MemberRow } from './members/schemas.js'
import { borrowedRole } from './proposals/delegation.js'
import { drawSpaceGroupRoles, drawSpaceMembers, groupMembers, groups, spaceGroupRoles, spaceMembers } from './schema.js'
import { wikiCollections } from './schema-wiki.js'

/** Whose spaces: JiraIA's or LET’S Draw AI's — each keeps its grants in its own tables (ADR-0012). */
export type Product = 'jiraia' | 'draw'

/** Where a role comes from, as "why does this person have access" answers it (ADR-0012). */
export type AccessSource =
  | { source: 'organization_admin'; role: 'admin' }
  | { source: 'direct'; role: Role }
  | { source: 'group'; role: Role; groupId: string; groupName: string }
  | { source: 'organization'; role: 'reader' }

/** Where each product keeps the roles given to people and to groups. */
export const GRANT_TABLES = {
  jiraia: { direct: spaceMembers, group: spaceGroupRoles },
  draw: { direct: drawSpaceMembers, group: drawSpaceGroupRoles }
} as const

/**
 * Turns "who is calling" into "what they hold here" (ADR-0004).
 *
 * The token names a subject and nothing more; the member behind it and their role are read on every
 * request, so a role an admin changes, or a deactivation, takes effect on the very next call.
 */
export class AccessResolver {
  constructor(private readonly deps: { db: Database; admission: MemberAdmission }) {}

  /**
   * The active member behind the caller, admitting a person of the allowed domain on their first
   * request (ADR-0005). Anyone else is refused before any data is read.
   */
  async actor(caller: Caller): Promise<MemberRow> {
    return await this.deps.admission.admit(caller)
  }

  /**
   * The member's effective role on a space: the strongest of a direct role, their groups' roles, and the
   * reader floor — every space is visible to all of LET’S (ADR-0012). While an approved proposal runs,
   * its agent also holds the member role on the proposal's space (ADR-0019).
   */
  async forSpace(actor: MemberRow, spaceId: string, product: Product = 'jiraia'): Promise<Access> {
    const sources = await this.sources(actor, spaceId, product)
    const borrowed = product === 'jiraia' ? borrowedRole(actor.id, spaceId) : undefined
    return {
      active: actor.status === 'active',
      // Not on a personal collection, which is its member's alone (ADR-0034).
      isOrgAdmin: sources.some((each) => each.source === 'organization_admin'),
      spaceRole: strongest([...sources.map((each) => each.role), borrowed])
    }
  }

  /**
   * Every source of the member's access to the space, strongest first. A restricted or personal wiki
   * collection has no reader floor, and a personal one is not an organization admin's (ADR-0034).
   */
  async sources(member: MemberRow, spaceId: string, product: Product = 'jiraia'): Promise<AccessSource[]> {
    const [direct, viaGroups, closed] = await Promise.all([
      this._direct(member.id, spaceId, product),
      this._viaGroups(member.id, spaceId, product),
      product === 'draw' ? this.closedAs(spaceId) : undefined
    ])
    const sources: AccessSource[] = [
      ...(member.isOrgAdmin && closed !== 'personal'
        ? [{ source: 'organization_admin' as const, role: 'admin' as const }]
        : []),
      ...(direct ? [{ source: 'direct' as const, role: direct }] : []),
      ...viaGroups,
      ...(member.status === 'active' && !closed ? [{ source: 'organization' as const, role: 'reader' as const }] : [])
    ]
    return sources
  }

  /** How a wiki collection is closed — `restricted` or `personal` — or `undefined` for every other space. */
  async closedAs(spaceId: string): Promise<'restricted' | 'personal' | undefined> {
    const [row] = await this.deps.db
      .select({ access: wikiCollections.access })
      .from(wikiCollections)
      .where(eq(wikiCollections.spaceId, spaceId))
    return row?.access === 'restricted' || row?.access === 'personal' ? row.access : undefined
  }

  private async _direct(memberId: string, spaceId: string, product: Product): Promise<Role | undefined> {
    const table = GRANT_TABLES[product].direct
    const [row] = await this.deps.db
      .select({ role: table.role })
      .from(table)
      .where(and(eq(table.memberId, memberId), eq(table.spaceId, spaceId)))
    return row ? roleSchema.parse(row.role) : undefined
  }

  private async _viaGroups(memberId: string, spaceId: string, product: Product): Promise<AccessSource[]> {
    const table = GRANT_TABLES[product].group
    const rows = await this.deps.db
      .select({ role: table.role, groupId: groups.id, groupName: groups.name })
      .from(table)
      .innerJoin(groups, eq(groups.id, table.groupId))
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(and(eq(table.spaceId, spaceId), eq(groupMembers.memberId, memberId), isNull(groups.deletedAt)))
    return rows.map((row) => ({
      source: 'group',
      role: roleSchema.parse(row.role),
      groupId: row.groupId,
      groupName: row.groupName
    }))
  }
}

/** Organization-level actions — inviting people, creating spaces — belong to organization admins. */
export const assertOrgAdmin = (actor: MemberRow, action: string): void => {
  if (!actor.isOrgAdmin) {
    throw new ForbiddenException(`Only an organization admin may ${action}`, { action, memberId: actor.id })
  }
}

/** Spaces of both products are created by organization admins and space managers (ADR-0012). */
export const assertCreatesSpaces = (actor: MemberRow): void => {
  if (!actor.isOrgAdmin && !actor.isSpaceManager) {
    throw new ForbiddenException('Only an organization admin or a space manager may create spaces', {
      memberId: actor.id
    })
  }
}
