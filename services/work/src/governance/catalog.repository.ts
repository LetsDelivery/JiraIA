import type { Database } from '@jiraia/db'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { members } from '../schema.js'
import { accessProfiles, accessSystemStaff, accessSystems } from '../schema-governance.js'
import type { Duty, ProfileRow, StaffRow, SystemRow } from './catalog.schemas.js'

export class CatalogRepository {
  constructor(private readonly db: Database) {}

  async systems(organizationId: string): Promise<SystemRow[]> {
    return await this.db
      .select()
      .from(accessSystems)
      .where(eq(accessSystems.organizationId, organizationId))
      .orderBy(asc(accessSystems.name))
  }

  async system(organizationId: string, id: string): Promise<SystemRow | undefined> {
    const [row] = await this.db
      .select()
      .from(accessSystems)
      .where(and(eq(accessSystems.organizationId, organizationId), eq(accessSystems.id, id)))
    return row
  }

  async profilesOf(systemIds: readonly string[]): Promise<ProfileRow[]> {
    if (systemIds.length === 0) {
      return []
    }
    return await this.db
      .select()
      .from(accessProfiles)
      .where(inArray(accessProfiles.systemId, [...systemIds]))
      .orderBy(asc(accessProfiles.name))
  }

  async profile(id: string): Promise<ProfileRow | undefined> {
    const [row] = await this.db.select().from(accessProfiles).where(eq(accessProfiles.id, id))
    return row
  }

  /** Who answers for these systems, by name. */
  async staffOf(systemIds: readonly string[]): Promise<StaffRow[]> {
    if (systemIds.length === 0) {
      return []
    }
    return await this.db
      .select({
        systemId: accessSystemStaff.systemId,
        memberId: accessSystemStaff.memberId,
        name: members.name,
        email: members.email,
        duty: accessSystemStaff.duty
      })
      .from(accessSystemStaff)
      .innerJoin(members, eq(members.id, accessSystemStaff.memberId))
      .where(inArray(accessSystemStaff.systemId, [...systemIds]))
      .orderBy(asc(members.name))
  }

  /** Every system a member answers for, with the duty. */
  async dutiesOf(memberId: string): Promise<{ systemId: string; duty: string }[]> {
    return await this.db
      .select({ systemId: accessSystemStaff.systemId, duty: accessSystemStaff.duty })
      .from(accessSystemStaff)
      .where(eq(accessSystemStaff.memberId, memberId))
  }

  async insertSystem(tx: Database, row: SystemRow): Promise<void> {
    await tx.insert(accessSystems).values(row)
  }

  async updateSystem(tx: Database, id: string, fields: Partial<SystemRow>): Promise<void> {
    await tx.update(accessSystems).set(fields).where(eq(accessSystems.id, id))
  }

  async insertProfile(tx: Database, row: ProfileRow): Promise<void> {
    await tx.insert(accessProfiles).values(row)
  }

  async updateProfile(tx: Database, id: string, fields: Partial<ProfileRow>): Promise<void> {
    await tx.update(accessProfiles).set(fields).where(eq(accessProfiles.id, id))
  }

  async putStaff(tx: Database, row: typeof accessSystemStaff.$inferInsert): Promise<void> {
    await tx.insert(accessSystemStaff).values(row).onConflictDoNothing()
  }

  async removeStaff(tx: Database, systemId: string, duty: Duty, memberId: string): Promise<void> {
    await tx
      .delete(accessSystemStaff)
      .where(
        and(
          eq(accessSystemStaff.systemId, systemId),
          eq(accessSystemStaff.duty, duty),
          eq(accessSystemStaff.memberId, memberId)
        )
      )
  }
}
