import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { z } from 'zod'

import { type AccessResolver, assertOrgAdmin } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CatalogRepository } from './catalog.repository.js'
import type { ProfileRow, SystemRow } from './catalog.schemas.js'
import { PRIVILEGED_MAX_DAYS } from './policy.js'
import type { EntitlementRequestRepository } from './request.repository.js'
import { BLANK_REQUEST } from './request.schemas.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const inventoryRowSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  system: z.string().trim().min(1),
  profile: z.string().trim().min(1),
  /** The day it was granted, when known; the import's day otherwise. */
  grantedAt: z.iso.date().optional(),
  expiresAt: z.iso.date().optional(),
  reason: z.string().trim().max(1000).optional()
})
export type InventoryRow = z.infer<typeof inventoryRowSchema>
export const importSchema = z.object({ rows: z.array(inventoryRowSchema).min(1).max(1000) })

/** Why a row was left out; the panel words each code. */
export const skipReasonSchema = z.enum(['unknown_person', 'unknown_system', 'unknown_profile', 'already_held'])
export const importResultSchema = z.object({
  imported: z.number().int(),
  /** Privileged rows with no expiry, given the longest one a privileged grant may have. */
  expiryAssigned: z.number().int(),
  skipped: z.array(z.object({ row: z.number().int(), reason: skipReasonSchema }))
})
export type ImportResult = z.infer<typeof importResultSchema>

type Catalog = { systems: SystemRow[]; profiles: ProfileRow[]; members: MemberRow[] }
type Match = { member: MemberRow; system: SystemRow; profile: ProfileRow }

/** A São Paulo day's start, as UTC. */
const _day = (day: string): Date => new Date(`${day}T00:00:00.000-03:00`)

/**
 * The access LET’S people already hold, loaded once (ADR-0024, A.15): each row becomes an
 * entitlement with a done grant of origin `inventory`, carried out by the importing admin — so it
 * enters the next review like any other. Privilege is never open-ended: a privileged row with no
 * expiry gets the longest one allowed.
 */
export class InventoryImport {
  constructor(
    private readonly deps: {
      db: Database
      clock: Clock
      ids: IdGenerator
      audit: AuditTrail
      access: AccessResolver
      catalog: CatalogRepository
      requests: EntitlementRequestRepository
      members: MemberRepository
    }
  ) {}

  async run(caller: Caller, rows: readonly InventoryRow[]): Promise<ImportResult> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'import the access inventory')
    const catalog = await this._catalog(actor)
    const result: ImportResult = { imported: 0, expiryAssigned: 0, skipped: [] }
    for (const [index, row] of rows.entries()) {
      const outcome = await this._one(actor, catalog, row)
      if (typeof outcome === 'string') {
        result.skipped.push({ row: index + 1, reason: outcome })
      } else {
        result.imported += 1
        result.expiryAssigned += outcome.expiryAssigned ? 1 : 0
      }
    }
    return result
  }

  private async _catalog(actor: MemberRow): Promise<Catalog> {
    const systems = (await this.deps.catalog.systems(actor.organizationId)).filter((each) => !each.archivedAt)
    const profiles = await this.deps.catalog.profilesOf(systems.map((each) => each.id))
    const members = (await this.deps.members.list(actor.organizationId)).filter(
      (each) => each.kind === 'person' && each.status === 'active'
    )
    return { systems, profiles, members }
  }

  private _match(catalog: Catalog, row: InventoryRow): Match | z.infer<typeof skipReasonSchema> {
    const member = catalog.members.find((each) => each.email === row.email)
    const system = catalog.systems.find((each) => each.name.toLowerCase() === row.system.toLowerCase())
    const profile = catalog.profiles.find(
      (each) =>
        each.systemId === system?.id && !each.archivedAt && each.name.toLowerCase() === row.profile.toLowerCase()
    )
    if (!member) {
      return 'unknown_person'
    }
    if (!system) {
      return 'unknown_system'
    }
    return profile ? { member, system, profile } : 'unknown_profile'
  }

  private async _one(actor: MemberRow, catalog: Catalog, row: InventoryRow) {
    const match = this._match(catalog, row)
    if (typeof match === 'string') {
      return match
    }
    if (await this.deps.requests.held(match.profile.id, match.member.id)) {
      return 'already_held' as const
    }
    const now = this.deps.clock.now()
    const assigned = match.profile.privilege === 'privileged' && !row.expiresAt
    const expiresAt = row.expiresAt
      ? _day(row.expiresAt)
      : assigned
        ? new Date(now.getTime() + PRIVILEGED_MAX_DAYS * DAY_MS)
        : null
    await this.deps.db.transaction((tx) => this._record(tx, actor, match, { row, now, expiresAt }))
    return { expiryAssigned: assigned }
  }

  private async _record(
    tx: Database,
    actor: MemberRow,
    { member, system, profile }: Match,
    { row, now, expiresAt }: { row: InventoryRow; now: Date; expiresAt: Date | null }
  ): Promise<void> {
    const requestId = this.deps.ids.next()
    const entitlementId = this.deps.ids.next()
    // Only a reason the sheet gave; otherwise `origin` says why, and the panel words it.
    const reason = row.reason ?? ''
    await this.deps.requests.insert(tx, {
      ...BLANK_REQUEST,
      id: requestId,
      organizationId: actor.organizationId,
      systemId: system.id,
      profileId: profile.id,
      beneficiaryId: member.id,
      requesterId: actor.id,
      kind: 'grant',
      status: 'done',
      origin: 'inventory',
      reason,
      expiresAt,
      completedBy: actor.id,
      completedAt: now,
      evidence: '',
      createdAt: now
    })
    await this.deps.requests.insertEntitlement(tx, {
      id: entitlementId,
      organizationId: actor.organizationId,
      systemId: system.id,
      profileId: profile.id,
      memberId: member.id,
      grantRequestId: requestId,
      grantedAt: row.grantedAt ? _day(row.grantedAt) : now,
      expiresAt,
      removalRequestId: null,
      removedAt: null
    })
    const base = { organizationId: actor.organizationId, spaceId: null, actorId: actor.id }
    await this.deps.audit.record(tx, {
      ...base,
      entityType: 'entitlement_request',
      entityId: requestId,
      action: 'imported',
      changes: { profileId: { before: null, after: profile.id }, beneficiaryId: { before: null, after: member.id } }
    })
    await this.deps.audit.record(tx, {
      ...base,
      entityType: 'entitlement',
      entityId: entitlementId,
      action: 'granted',
      changes: { profileId: { before: null, after: profile.id } }
    })
  }
}
