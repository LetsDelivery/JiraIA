import type { Database } from '@jiraia/db'
import { and, asc, eq } from 'drizzle-orm'

import { cardAttachments, members } from '../schema.js'
import type { AttachmentRow } from './attachment.schemas.js'

export class AttachmentRepository {
  constructor(private readonly db: Database) {}

  /** A card's uploaded files, oldest first, with who sent each. */
  async ready(cardId: string): Promise<(AttachmentRow & { uploaderName: string })[]> {
    const rows = await this.db
      .select({ attachment: cardAttachments, uploaderName: members.name })
      .from(cardAttachments)
      .innerJoin(members, eq(members.id, cardAttachments.uploadedBy))
      .where(and(eq(cardAttachments.cardId, cardId), eq(cardAttachments.status, 'ready')))
      .orderBy(asc(cardAttachments.createdAt))

    return rows.map((row) => ({ ...row.attachment, uploaderName: row.uploaderName }))
  }

  async find(cardId: string, id: string): Promise<AttachmentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cardAttachments)
      .where(and(eq(cardAttachments.cardId, cardId), eq(cardAttachments.id, id)))
    return row
  }

  async insert(row: AttachmentRow): Promise<void> {
    await this.db.insert(cardAttachments).values(row)
  }

  async markReady(tx: Database, id: string): Promise<void> {
    await tx.update(cardAttachments).set({ status: 'ready' }).where(eq(cardAttachments.id, id))
  }

  async delete(tx: Database, id: string): Promise<void> {
    await tx.delete(cardAttachments).where(eq(cardAttachments.id, id))
  }
}
