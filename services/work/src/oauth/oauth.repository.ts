import type { Database } from '@jiraia/db'
import { and, desc, eq, isNull } from 'drizzle-orm'

import { oauthClients, oauthCodes, oauthConnections, oauthTokens } from '../schema-agents.js'
import type { ClientRow, CodeRow, ConnectionRow, TokenRow } from './schemas.js'

export class OAuthRepository {
  constructor(private readonly db: Database) {}

  async insertClient(row: ClientRow): Promise<void> {
    await this.db.insert(oauthClients).values(row)
  }

  async client(id: string): Promise<ClientRow | undefined> {
    const [row] = await this.db.select().from(oauthClients).where(eq(oauthClients.id, id))
    return row
  }

  async insertCode(row: CodeRow): Promise<void> {
    await this.db.insert(oauthCodes).values(row)
  }

  /** Takes a code once: whether this call was the one that used it is the answer. */
  async useCode(hash: string, at: Date): Promise<CodeRow | undefined> {
    const [row] = await this.db
      .update(oauthCodes)
      .set({ usedAt: at })
      .where(and(eq(oauthCodes.hash, hash), isNull(oauthCodes.usedAt)))
      .returning()
    return row
  }

  async insertConnection(tx: Database, row: ConnectionRow): Promise<void> {
    await tx.insert(oauthConnections).values(row)
  }

  async connection(id: string): Promise<ConnectionRow | undefined> {
    const [row] = await this.db.select().from(oauthConnections).where(eq(oauthConnections.id, id))
    return row
  }

  /** The person's live connection to a client, if they allowed it before. */
  async liveConnection(clientId: string, personId: string): Promise<ConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.clientId, clientId),
          eq(oauthConnections.personId, personId),
          isNull(oauthConnections.revokedAt)
        )
      )
    return row
  }

  async connectionsOf(personId: string): Promise<{ connection: ConnectionRow; client: ClientRow }[]> {
    return await this.db
      .select({ connection: oauthConnections, client: oauthClients })
      .from(oauthConnections)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthConnections.clientId))
      .where(and(eq(oauthConnections.personId, personId), isNull(oauthConnections.revokedAt)))
      .orderBy(desc(oauthConnections.createdAt))
  }

  async touchConnection(id: string, at: Date): Promise<void> {
    await this.db.update(oauthConnections).set({ lastUsedAt: at }).where(eq(oauthConnections.id, id))
  }

  /** Ends a connection and every token of it. */
  async revokeConnection(tx: Database, id: string, at: Date): Promise<void> {
    await tx.update(oauthConnections).set({ revokedAt: at }).where(eq(oauthConnections.id, id))
    await tx
      .update(oauthTokens)
      .set({ revokedAt: at })
      .where(and(eq(oauthTokens.connectionId, id), isNull(oauthTokens.revokedAt)))
  }

  async insertTokens(tx: Database, rows: readonly TokenRow[]): Promise<void> {
    await tx.insert(oauthTokens).values([...rows])
  }

  async token(hash: string): Promise<TokenRow | undefined> {
    const [row] = await this.db.select().from(oauthTokens).where(eq(oauthTokens.hash, hash))
    return row
  }

  /** Revokes a token only if it is still live — a refresh token rotates once. */
  async revokeToken(tx: Database, hash: string, at: Date): Promise<boolean> {
    const revoked = await tx
      .update(oauthTokens)
      .set({ revokedAt: at })
      .where(and(eq(oauthTokens.hash, hash), isNull(oauthTokens.revokedAt)))
      .returning({ hash: oauthTokens.hash })
    return revoked.length > 0
  }
}
