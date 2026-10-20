import { ForbiddenException } from '@jiraia/core'
import { z } from 'zod'

/**
 * Who may do what, decided from the role a member holds on one space (ADR-0004, ADR-0007).
 *
 * Pure on purpose: the service reads the role from its own store and hands it in, so every branch of
 * the matrix is a unit test rather than a database fixture. The same function decides for a person,
 * an agent and an API token — they are all members.
 */
export const roleValues = ['admin', 'member', 'reader'] as const
export const roleSchema = z.enum(roleValues)
export type Role = z.infer<typeof roleSchema>

/**
 * `space:write` is working on the space's cards and pages. `space:manage` is the space itself: its
 * name, type, lead, roles and archiving. Everyone at LET’S signs in with their @uselets address and
 * reads; what they may change is given to them afterwards (ADR-0012).
 */
export const actionValues = ['space:read', 'space:write', 'space:manage'] as const
export type Action = (typeof actionValues)[number]

export type Access = {
  active: boolean
  isOrgAdmin: boolean
  spaceRole?: Role | undefined
}

const ALLOWED: Record<Action, readonly Role[]> = {
  'space:read': ['admin', 'member', 'reader'],
  'space:write': ['admin', 'member'],
  'space:manage': ['admin']
}

/**
 * @example can({ active: true, isOrgAdmin: false, spaceRole: 'reader' }, 'space:write')   // false
 */
export const can = (access: Access, action: Action): boolean => {
  if (!access.active) {
    return false
  }

  return access.isOrgAdmin || (access.spaceRole !== undefined && ALLOWED[action].includes(access.spaceRole))
}

/**
 * Throws a 403 naming the action and the role that was not enough.
 *
 * @example assertCan(access, 'space:manage', { spaceId })
 */
export const assertCan = (access: Access, action: Action, subject: Record<string, string>): void => {
  if (can(access, action)) {
    return
  }

  throw new ForbiddenException(`The caller may not ${action} with the role they hold`, {
    action,
    spaceRole: access.spaceRole ?? null,
    ...subject
  })
}

/** Stronger first: an admin does all a member does, a member all a reader does (ADR-0012). */
const RANK: Record<Role, number> = { admin: 3, member: 2, reader: 1 }

/**
 * The strongest of the roles a member holds on a space — given directly, through their groups, and the
 * reader floor every member of the organization has (ADR-0012). `undefined` when they hold none.
 *
 * @example strongest(['reader', 'member', undefined])   // 'member'
 */
export const strongest = (roles: readonly (Role | undefined)[]): Role | undefined =>
  roles.reduce<Role | undefined>(
    (best, role) => (role !== undefined && (best === undefined || RANK[role] > RANK[best]) ? role : best),
    undefined
  )
