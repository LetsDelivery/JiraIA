import type { Database } from '@jiraia/db'
import { eq } from 'drizzle-orm'

import { slackLinks, slackWorkspaces } from '../schema-intake.js'

export type WorkspaceRow = typeof slackWorkspaces.$inferSelect
export type LinkRow = typeof slackLinks.$inferSelect

/** The connected workspace of each organization, and who each member is in it (Etapa 5e). */
export class SlackRepository {
  constructor(private readonly db: Database) {}

  async workspace(organizationId: string): Promise<WorkspaceRow | undefined> {
    const [row] = await this.db.select().from(slackWorkspaces).where(eq(slackWorkspaces.organizationId, organizationId))
    return row
  }

  /** The organization a Slack team belongs to, for the events Slack sends. */
  async byTeam(teamId: string): Promise<WorkspaceRow | undefined> {
    const [row] = await this.db.select().from(slackWorkspaces).where(eq(slackWorkspaces.teamId, teamId))
    return row
  }

  async saveWorkspace(tx: Database, row: WorkspaceRow): Promise<void> {
    const { organizationId, ...rest } = row
    await tx
      .insert(slackWorkspaces)
      .values(row)
      .onConflictDoUpdate({ target: slackWorkspaces.organizationId, set: rest })
  }

  /** Disconnecting forgets the workspace and who everyone was in it. */
  async removeWorkspace(tx: Database, organizationId: string): Promise<void> {
    await tx.delete(slackLinks).where(eq(slackLinks.organizationId, organizationId))
    await tx.delete(slackWorkspaces).where(eq(slackWorkspaces.organizationId, organizationId))
  }

  async link(memberId: string): Promise<LinkRow | undefined> {
    const [row] = await this.db.select().from(slackLinks).where(eq(slackLinks.memberId, memberId))
    return row
  }

  async saveLink(row: LinkRow): Promise<void> {
    const { memberId, ...rest } = row
    await this.db.insert(slackLinks).values(row).onConflictDoUpdate({ target: slackLinks.memberId, set: rest })
  }
}
