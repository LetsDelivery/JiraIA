import { type Clock, ConflictException, type IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { auditEvents, members, organizations } from '../schema.js'
import type { MemberRow } from './schemas.js'

export type BootstrapInput = { organizationName: string; admin: { email: string; name: string } }

/**
 * Creates the organization and its first admin — the one write no member can make, because before it
 * there is no member to make it.
 *
 * Run once per environment: by the local seed, and by hand after the first deploy. The admin then
 * signs in with Google like anybody else and is recognised by their address. It refuses when an
 * organization already exists, so running it twice cannot mint a second admin behind everyone's back.
 */
export const bootstrapOrganization = async (
  deps: { db: Database; clock: Clock; ids: IdGenerator },
  input: BootstrapInput
): Promise<MemberRow> => {
  const [existing] = await deps.db.select({ id: organizations.id }).from(organizations).limit(1)
  if (existing) {
    throw new ConflictException('The organization already exists; invite admins from inside it', {
      organizationId: existing.id
    })
  }

  const email = input.admin.email.toLowerCase()
  const now = deps.clock.now()
  const organizationId = deps.ids.next()
  const admin: MemberRow = {
    id: deps.ids.next(),
    organizationId,
    kind: 'person',
    // Bound to their Google account on their first sign-in, like any invited member (ADR-0005).
    subject: null,
    email,
    name: input.admin.name,
    jobTitle: null,
    isOrgAdmin: true,
    isSpaceManager: false,
    status: 'active',
    createdAt: now,
    deactivatedAt: null
  }

  await deps.db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: organizationId, name: input.organizationName, createdAt: now })
    await tx.insert(members).values(admin)
    await tx.insert(auditEvents).values({
      id: deps.ids.next(),
      organizationId,
      spaceId: null,
      actorId: admin.id,
      entityType: 'member',
      entityId: admin.id,
      action: 'bootstrapped',
      changes: { isOrgAdmin: { before: null, after: true } },
      occurredAt: now
    })
  })

  return admin
}
