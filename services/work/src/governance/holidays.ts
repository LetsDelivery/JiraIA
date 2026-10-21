import { type Clock, ConflictException, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { type AccessResolver, assertOrgAdmin } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import { businessHolidays } from '../schema-governance.js'
import { addBusinessDays, addHours, nationalHolidays } from './calendar.js'
import type { SystemRow } from './catalog.schemas.js'

const daySchema = z.iso.date()
export const holidayPathSchema = z.object({ day: daySchema })
export const putHolidaySchema = z.object({ name: z.string().trim().min(1).max(80) })
export const holidayViewSchema = z.object({ day: z.iso.date(), name: z.string(), national: z.boolean() })
export const holidayListSchema = z.object({ items: z.array(holidayViewSchema) })
export type HolidayView = z.infer<typeof holidayViewSchema>

/** The organization's own days off: a city's or a state's holiday, a company day. */
export class HolidayRepository {
  constructor(private readonly db: Database) {}

  async list(organizationId: string): Promise<{ day: string; name: string }[]> {
    return await this.db
      .select({ day: businessHolidays.day, name: businessHolidays.name })
      .from(businessHolidays)
      .where(eq(businessHolidays.organizationId, organizationId))
      .orderBy(asc(businessHolidays.day))
  }

  async days(organizationId: string): Promise<Set<string>> {
    return new Set((await this.list(organizationId)).map((each) => each.day))
  }

  async put(tx: Database, row: typeof businessHolidays.$inferInsert): Promise<void> {
    await tx
      .insert(businessHolidays)
      .values(row)
      .onConflictDoUpdate({ target: [businessHolidays.organizationId, businessHolidays.day], set: { name: row.name } })
  }

  async remove(tx: Database, organizationId: string, day: string): Promise<void> {
    await tx
      .delete(businessHolidays)
      .where(and(eq(businessHolidays.organizationId, organizationId), eq(businessHolidays.day, day)))
  }
}

/** When a request must be carried out, by the system's SLA and the São Paulo calendar (ADR-0024). */
export class SlaClock {
  constructor(private readonly holidays: HolidayRepository) {}

  async grant(system: SystemRow, approvedAt: Date): Promise<Date> {
    return addBusinessDays(approvedAt, system.grantSlaDays, await this.holidays.days(system.organizationId))
  }

  async removal(system: SystemRow, askedAt: Date): Promise<Date> {
    return addBusinessDays(askedAt, system.removalSlaDays, await this.holidays.days(system.organizationId))
  }

  departure(system: SystemRow, leftAt: Date): Date {
    return addHours(leftAt, system.departureSlaHours)
  }
}

/** The calendar the SLAs count on: everyone reads it; an organization admin adds and removes days. */
export class HolidayService {
  constructor(
    private readonly deps: {
      db: Database
      clock: Clock
      audit: AuditTrail
      access: AccessResolver
      holidays: HolidayRepository
    }
  ) {}

  /** This year's and next year's national holidays, beside the organization's own days. */
  async list(caller: Caller): Promise<{ items: HolidayView[] }> {
    const actor = await this.deps.access.actor(caller)
    const year = Number(this.deps.clock.now().toISOString().slice(0, 4))
    const national = [...nationalHolidays(year), ...nationalHolidays(year + 1)].map((day) => ({
      day,
      name: '',
      national: true
    }))
    const own = (await this.deps.holidays.list(actor.organizationId)).map((each) => ({ ...each, national: false }))
    return { items: [...national, ...own].sort((a, b) => a.day.localeCompare(b.day)) }
  }

  async put(caller: Caller, day: string, name: string): Promise<{ items: HolidayView[] }> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'change the business calendar')
    if (nationalHolidays(Number(day.slice(0, 4))).includes(day)) {
      throw new ConflictException(`Day "${day}" is already a national holiday`, { nationalHoliday: day })
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.holidays.put(tx, {
        organizationId: actor.organizationId,
        day,
        name,
        createdAt: this.deps.clock.now()
      })
      await this._audit(tx, actor.organizationId, actor.id, 'holiday_added', { [day]: { before: null, after: name } })
    })
    return await this.list(caller)
  }

  async remove(caller: Caller, day: string): Promise<{ items: HolidayView[] }> {
    const actor = await this.deps.access.actor(caller)
    assertOrgAdmin(actor, 'change the business calendar')
    const held = (await this.deps.holidays.list(actor.organizationId)).find((each) => each.day === day)
    if (!held) {
      throw new NotFoundException('Holiday', day)
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.holidays.remove(tx, actor.organizationId, day)
      await this._audit(tx, actor.organizationId, actor.id, 'holiday_removed', {
        [day]: { before: held.name, after: null }
      })
    })
    return await this.list(caller)
  }

  private async _audit(
    tx: Database,
    organizationId: string,
    actorId: string,
    action: string,
    changes: Record<string, { before: unknown; after: unknown }>
  ) {
    await this.deps.audit.record(tx, {
      organizationId,
      spaceId: null,
      actorId,
      entityType: 'organization',
      entityId: organizationId,
      action,
      changes
    })
  }
}
