import { type Clock, ForbiddenException, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { and, eq, gte, isNull, lt, ne } from 'drizzle-orm'
import { z } from 'zod'

import type { AccessResolver } from '../access.js'
import type { MemberRow } from '../members/schemas.js'
import { accessProfiles, type accessSystems, entitlementRequests, entitlements } from '../schema-governance.js'
import type { CatalogRepository } from './catalog.repository.js'

export const reportQuerySchema = z.object({ from: z.iso.date(), to: z.iso.date() })
export const reportRowSchema = z.object({
  system: z.object({ id: z.uuid(), name: z.string() }),
  holdsPersonalData: z.boolean(),
  held: z.number().int(),
  privilegedHeld: z.number().int(),
  /** Requests carried out in the period, and how many within their deadline. */
  done: z.number().int(),
  onTime: z.number().int(),
  /** Still open now and already past their deadline. */
  openLate: z.number().int(),
  /** `onTime / done`, or null when nothing was carried out. */
  compliance: z.number().nullable()
})
export type ReportRow = z.infer<typeof reportRowSchema>
export const reportSchema = z.object({ from: z.iso.date(), to: z.iso.date(), items: z.array(reportRowSchema) })

type Closed = { systemId: string; dueAt: Date | null; completedAt: Date | null; overdueAt: Date | null }
type Held = { systemId: string; privilege: string }

/** A request is on time when it was done by its deadline and never found late. */
export const onTime = (request: Omit<Closed, 'systemId'>): boolean =>
  request.overdueAt === null &&
  (request.dueAt === null || (request.completedAt !== null && request.completedAt <= request.dueAt))

/**
 * What an auditor asks of access governance (ADR-0024, ISO 27001 5.18): per system, who holds what
 * now, how much of it is privileged, whether it holds personal data (27701), and how the SLAs were
 * met in a period. Auditors and admins see every system; owners and operators, theirs.
 */
export class AccessReport {
  constructor(
    private readonly deps: { db: Database; clock: Clock; access: AccessResolver; catalog: CatalogRepository }
  ) {}

  async read(caller: Caller, from: string, to: string): Promise<z.infer<typeof reportSchema>> {
    const actor = await this.deps.access.actor(caller)
    if (from > to) {
      throw new ValidationException(`Period "${from}".."${to}" ends before it starts`, { from, to })
    }
    const systems = await this._systems(actor)
    const [held, closed] = await Promise.all([this._held(actor), this._closed(actor, from, to)])
    const late = await this._openLate(actor)
    return { from, to, items: systems.map((system) => _row(system, held, closed, late)) }
  }

  private async _systems(actor: MemberRow) {
    const all = (await this.deps.catalog.systems(actor.organizationId)).filter((each) => !each.archivedAt)
    if (actor.isOrgAdmin || actor.isAccessAuditor) {
      return all
    }
    const mine = new Set((await this.deps.catalog.dutiesOf(actor.id)).map((each) => each.systemId))
    if (mine.size === 0) {
      throw new ForbiddenException('Only access auditors, admins and system staff may read the access report', {
        memberId: actor.id
      })
    }
    return all.filter((each) => mine.has(each.id))
  }

  private async _held(actor: MemberRow): Promise<Held[]> {
    return await this.deps.db
      .select({ systemId: entitlements.systemId, privilege: accessProfiles.privilege })
      .from(entitlements)
      .innerJoin(accessProfiles, eq(accessProfiles.id, entitlements.profileId))
      .where(and(eq(entitlements.organizationId, actor.organizationId), isNull(entitlements.removedAt)))
  }

  /** Requests carried out from the first day to the last, both whole São Paulo days. */
  private async _closed(actor: MemberRow, from: string, to: string): Promise<Closed[]> {
    const start = new Date(`${from}T00:00:00.000-03:00`)
    const end = new Date(new Date(`${to}T00:00:00.000-03:00`).getTime() + 24 * 60 * 60 * 1000)
    return await this.deps.db
      .select({
        systemId: entitlementRequests.systemId,
        dueAt: entitlementRequests.dueAt,
        completedAt: entitlementRequests.completedAt,
        overdueAt: entitlementRequests.overdueAt
      })
      .from(entitlementRequests)
      .where(
        and(
          eq(entitlementRequests.organizationId, actor.organizationId),
          eq(entitlementRequests.status, 'done'),
          // What was imported was never asked here: it says nothing of how the SLAs were met.
          ne(entitlementRequests.origin, 'inventory'),
          gte(entitlementRequests.completedAt, start),
          lt(entitlementRequests.completedAt, end)
        )
      )
  }

  private async _openLate(actor: MemberRow): Promise<string[]> {
    const rows = await this.deps.db
      .select({ systemId: entitlementRequests.systemId })
      .from(entitlementRequests)
      .where(
        and(
          eq(entitlementRequests.organizationId, actor.organizationId),
          eq(entitlementRequests.status, 'approved'),
          lt(entitlementRequests.dueAt, this.deps.clock.now())
        )
      )
    return rows.map((row) => row.systemId)
  }
}

const _row = (
  system: typeof accessSystems.$inferSelect,
  held: readonly Held[],
  closed: readonly Closed[],
  late: readonly string[]
): ReportRow => {
  const mine = held.filter((each) => each.systemId === system.id)
  const done = closed.filter((each) => each.systemId === system.id)
  const timely = done.filter(onTime).length
  return {
    system: { id: system.id, name: system.name },
    holdsPersonalData: system.holdsPersonalData,
    held: mine.length,
    privilegedHeld: mine.filter((each) => each.privilege === 'privileged').length,
    done: done.length,
    onTime: timely,
    openLate: late.filter((each) => each === system.id).length,
    compliance: done.length ? timely / done.length : null
  }
}
