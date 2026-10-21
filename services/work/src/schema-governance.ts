import { sql } from 'drizzle-orm'
import { boolean, index, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { members, work } from './schema.js'

/**
 * Access governance (ADR-0024): which LET’S systems exist, the profiles each grants, who asked for
 * which, and who holds what. Same schema, same rules as `schema.ts`. Nothing here is ever deleted.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** Something LET’S grants access to — AWS, Google Workspace, JiraIA itself. */
export const accessSystems = work.table(
  'access_systems',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Whether the system holds personal data (ISO/IEC 27701). */
    holdsPersonalData: boolean('holds_personal_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: at('archived_at')
  },
  (table) => [index('access_systems_organization').on(table.organizationId)]
)

/** Who answers for a system: an `owner` approves and reviews, an `operator` carries out. */
export const accessSystemStaff = work.table(
  'access_system_staff',
  {
    systemId: uuid('system_id')
      .notNull()
      .references(() => accessSystems.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    duty: text('duty').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    primaryKey({ columns: [table.systemId, table.memberId, table.duty] }),
    index('access_system_staff_member').on(table.memberId)
  ]
)

/** A named set of rights in one system, `standard` or `privileged`; access exists only through one. */
export const accessProfiles = work.table(
  'access_profiles',
  {
    id: uuid('id').primaryKey(),
    systemId: uuid('system_id')
      .notNull()
      .references(() => accessSystems.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    privilege: text('privilege').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: at('archived_at')
  },
  (table) => [index('access_profiles_system').on(table.systemId)]
)

/**
 * A request to grant or remove one profile for one person, with its reason. `requested`, then
 * `approved` or `declined`, then `done` (with evidence) or `cancelled`. A removal starts approved.
 */
export const entitlementRequests = work.table(
  'entitlement_requests',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    systemId: uuid('system_id')
      .notNull()
      .references(() => accessSystems.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => accessProfiles.id),
    beneficiaryId: uuid('beneficiary_id')
      .notNull()
      .references(() => members.id),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => members.id),
    /** `grant` or `removal`. */
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    /** Until when a privileged grant lasts; null for a standard one and for a removal. */
    expiresAt: at('expires_at'),
    /** The entitlement a removal ends. */
    entitlementId: uuid('entitlement_id'),
    decidedBy: uuid('decided_by').references(() => members.id),
    decidedAt: at('decided_at'),
    decisionNote: text('decision_note'),
    completedBy: uuid('completed_by').references(() => members.id),
    completedAt: at('completed_at'),
    evidence: text('evidence'),
    createdAt: createdAt()
  },
  (table) => [
    index('entitlement_requests_system').on(table.systemId, table.status),
    index('entitlement_requests_beneficiary').on(table.beneficiaryId),
    uniqueIndex('entitlement_requests_open')
      .on(table.profileId, table.beneficiaryId, table.kind)
      .where(sql`status IN ('requested', 'approved')`)
  ]
)

/** A person holding a profile, from the request that granted it to the one that removed it. */
export const entitlements = work.table(
  'entitlements',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    systemId: uuid('system_id')
      .notNull()
      .references(() => accessSystems.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => accessProfiles.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    grantRequestId: uuid('grant_request_id')
      .notNull()
      .references(() => entitlementRequests.id),
    grantedAt: at('granted_at').notNull(),
    expiresAt: at('expires_at'),
    removalRequestId: uuid('removal_request_id').references(() => entitlementRequests.id),
    removedAt: at('removed_at')
  },
  (table) => [
    index('entitlements_member').on(table.memberId),
    index('entitlements_system').on(table.systemId),
    uniqueIndex('entitlements_held').on(table.profileId, table.memberId).where(sql`removed_at IS NULL`)
  ]
)
