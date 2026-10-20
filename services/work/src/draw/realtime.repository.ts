import type { Database } from '@jiraia/db'
import { and, eq, lt, ne } from 'drizzle-orm'

import { contentConnections, realtimeTickets } from '../schema.js'

export type Ticket = typeof realtimeTickets.$inferSelect
export type Connection = typeof contentConnections.$inferSelect

/** Tickets to connect, and who is connected to which page (ADR-0009). */
export class RealtimeRepository {
  constructor(private readonly db: Database) {}

  async issue(ticket: Ticket): Promise<void> {
    await this.db.insert(realtimeTickets).values(ticket)
  }

  /** The ticket, if it has not expired — and gone either way, so it opens one connection only. */
  async redeem(token: string, now: Date): Promise<Ticket | undefined> {
    const [row] = await this.db.delete(realtimeTickets).where(eq(realtimeTickets.token, token)).returning()
    return row && row.expiresAt > now ? row : undefined
  }

  async connect(connection: Connection): Promise<void> {
    await this.db.insert(contentConnections).values(connection)
  }

  async connection(connectionId: string): Promise<Connection | undefined> {
    const [row] = await this.db
      .select()
      .from(contentConnections)
      .where(eq(contentConnections.connectionId, connectionId))
    return row
  }

  /** The page's other connections, which a change is relayed to. */
  async others(contentId: string, connectionId: string): Promise<Connection[]> {
    return await this.db
      .select()
      .from(contentConnections)
      .where(and(eq(contentConnections.contentId, contentId), ne(contentConnections.connectionId, connectionId)))
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.db.delete(contentConnections).where(eq(contentConnections.connectionId, connectionId))
  }

  /** Tickets nobody used, so the table does not grow. */
  async dropExpired(now: Date): Promise<void> {
    await this.db.delete(realtimeTickets).where(lt(realtimeTickets.expiresAt, now))
  }
}
