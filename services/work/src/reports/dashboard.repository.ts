import type { Database } from '@jiraia/db'
import { and, eq } from 'drizzle-orm'

import { spaceDashboards } from '../schema-intake.js'

export type DashboardRow = typeof spaceDashboards.$inferSelect

export class DashboardRepository {
  constructor(private readonly db: Database) {}

  async find(organizationId: string, spaceId: string): Promise<DashboardRow | undefined> {
    const [row] = await this.db
      .select()
      .from(spaceDashboards)
      .where(and(eq(spaceDashboards.organizationId, organizationId), eq(spaceDashboards.spaceId, spaceId)))
    return row
  }

  async save(tx: Database, row: DashboardRow): Promise<void> {
    const { spaceId, ...changed } = row
    await tx.insert(spaceDashboards).values(row).onConflictDoUpdate({ target: spaceDashboards.spaceId, set: changed })
  }

  async remove(tx: Database, spaceId: string): Promise<void> {
    await tx.delete(spaceDashboards).where(eq(spaceDashboards.spaceId, spaceId))
  }
}
