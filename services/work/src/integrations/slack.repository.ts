import type { Database } from '@jiraia/db'
import { and, asc, eq } from 'drizzle-orm'

import { slackChannels } from '../schema-intake.js'
import type { SlackChannelRow } from './slack.schemas.js'

export class SlackChannelRepository {
  constructor(private readonly db: Database) {}

  async list(organizationId: string): Promise<SlackChannelRow[]> {
    return await this.db
      .select()
      .from(slackChannels)
      .where(eq(slackChannels.organizationId, organizationId))
      .orderBy(asc(slackChannels.name))
  }

  async find(organizationId: string, id: string): Promise<SlackChannelRow | undefined> {
    const [row] = await this.db
      .select()
      .from(slackChannels)
      .where(and(eq(slackChannels.organizationId, organizationId), eq(slackChannels.id, id)))
    return row
  }

  async insert(tx: Database, row: SlackChannelRow): Promise<void> {
    await tx.insert(slackChannels).values(row)
  }

  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(slackChannels).where(eq(slackChannels.id, id))
  }
}
