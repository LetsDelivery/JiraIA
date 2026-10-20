import type { Database } from '@jiraia/db'
import { and, asc, desc, eq } from 'drizzle-orm'

import { members } from '../schema.js'
import { automationRuns, automations } from '../schema-intake.js'
import type { AutomationRow, RunRow } from './schemas.js'

export type AutomationWithOwner = AutomationRow & { ownerName: string }

export class AutomationRepository {
  constructor(private readonly db: Database) {}

  async list(spaceId: string, onlyEnabled = false): Promise<AutomationWithOwner[]> {
    const rows = await this.db
      .select({ automation: automations, ownerName: members.name })
      .from(automations)
      .innerJoin(members, eq(members.id, automations.ownerId))
      .where(and(eq(automations.spaceId, spaceId), onlyEnabled ? eq(automations.enabled, true) : undefined))
      .orderBy(asc(automations.createdAt))
    return rows.map((row) => ({ ...row.automation, ownerName: row.ownerName }))
  }

  async find(organizationId: string, id: string): Promise<AutomationWithOwner | undefined> {
    const [row] = await this.db
      .select({ automation: automations, ownerName: members.name })
      .from(automations)
      .innerJoin(members, eq(members.id, automations.ownerId))
      .where(and(eq(automations.organizationId, organizationId), eq(automations.id, id)))
    return row ? { ...row.automation, ownerName: row.ownerName } : undefined
  }

  async insert(tx: Database, row: AutomationRow): Promise<void> {
    await tx.insert(automations).values(row)
  }

  async update(tx: Database, id: string, fields: Partial<AutomationRow>): Promise<void> {
    await tx.update(automations).set(fields).where(eq(automations.id, id))
  }

  /** Runs go with their rule: they explain it and nothing else. */
  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(automationRuns).where(eq(automationRuns.automationId, id))
    await tx.delete(automations).where(eq(automations.id, id))
  }

  async hasRun(automationId: string, eventId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.eventId, eventId)))
    return Boolean(row)
  }

  async insertRun(row: RunRow): Promise<void> {
    await this.db.insert(automationRuns).values(row).onConflictDoNothing()
  }

  async runs(automationId: string, limit: number): Promise<RunRow[]> {
    return await this.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, automationId))
      .orderBy(desc(automationRuns.occurredAt))
      .limit(limit)
  }
}
