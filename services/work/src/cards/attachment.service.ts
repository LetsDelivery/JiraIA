import { can } from '@jiraia/authorization'
import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail, Changes } from '../audit/audit.js'
import type { FileStore } from '../files/file-store.js'
import type { AttachmentRepository } from './attachment.repository.js'
import type { AttachmentRow, AttachmentView, CreateAttachment } from './attachment.schemas.js'
import type { CardRepository } from './card.repository.js'
import type { CardAccess, CardGate } from './card-gate.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  cardGate: CardGate
  cards: CardRepository
  attachments: AttachmentRepository
  files: FileStore
}

/**
 * Files on a card (escopo-mvp 2.9), uploaded in two steps so the bytes never pass through the API:
 * `start` records the attachment as pending and hands back where to send it; `complete` checks the
 * file arrived, makes it visible and writes the card's history.
 */
export class AttachmentService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller, cardId: string): Promise<{ items: AttachmentView[] }> {
    const { card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    return await this._list(card.id)
  }

  async start(caller: Caller, cardId: string, input: CreateAttachment) {
    const { gate, card } = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const id = this.deps.ids.next()
    const row: AttachmentRow = {
      id,
      cardId: card.id,
      ...input,
      objectKey: `${gate.actor.organizationId}/${card.id}/${id}`,
      status: 'pending',
      uploadedBy: gate.actor.id,
      createdAt: this.deps.clock.now()
    }
    await this.deps.attachments.insert(row)
    const upload = await this.deps.files.uploadUrl({ key: row.objectKey, contentType: row.contentType, size: row.size })
    return { id, upload }
  }

  /** The stored file must be the one announced — same size — or the attachment stays pending. */
  async complete(caller: Caller, cardId: string, attachmentId: string): Promise<{ items: AttachmentView[] }> {
    const access = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const attachment = await this._attachment(access, attachmentId)
    const stored = await this.deps.files.sizeOf(attachment.objectKey)
    if (stored !== attachment.size) {
      throw new ConflictException(`File "${attachment.name}" has not arrived yet`, {
        attachmentId,
        stored: stored ?? 0
      })
    }
    if (attachment.status !== 'ready') {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.attachments.markReady(tx, attachment.id)
        await this.deps.cards.touchSpace(tx, access.card.spaceId, this.deps.clock.now())
        await this._audit(tx, access, 'attached', { attachment: { before: null, after: attachment.name } })
      })
    }
    return await this._list(access.card.id)
  }

  /** The person who uploaded a file removes it, or an admin of the space. */
  async remove(caller: Caller, cardId: string, attachmentId: string): Promise<{ items: AttachmentView[] }> {
    const access = await this.deps.cardGate.open(caller, cardId, 'space:write')
    const attachment = await this._attachment(access, attachmentId)
    if (attachment.uploadedBy !== access.gate.actor.id && !can(access.gate.access, 'space:manage')) {
      throw new ForbiddenException('Only who uploaded a file, or a space admin, may remove it', { attachmentId })
    }

    await this.deps.db.transaction(async (tx) => {
      await this.deps.attachments.delete(tx, attachment.id)
      await this._audit(tx, access, 'detached', { attachment: { before: attachment.name, after: null } })
    })
    await this.deps.files.remove(attachment.objectKey)
    return await this._list(access.card.id)
  }

  private async _attachment(access: CardAccess, attachmentId: string): Promise<AttachmentRow> {
    const attachment = await this.deps.attachments.find(access.card.id, attachmentId)
    if (!attachment) {
      throw new NotFoundException('Attachment', attachmentId)
    }
    return attachment
  }

  private async _list(cardId: string): Promise<{ items: AttachmentView[] }> {
    const rows = await this.deps.attachments.ready(cardId)
    const urls = await Promise.all(rows.map((row) => this._urls(row)))
    return {
      items: rows.map((row, index) => ({
        id: row.id,
        name: row.name,
        contentType: row.contentType,
        size: row.size,
        uploadedBy: { id: row.uploadedBy, name: row.uploaderName },
        createdAt: row.createdAt.toISOString(),
        url: urls[index]?.url ?? '',
        previewUrl: urls[index]?.previewUrl ?? ''
      }))
    }
  }

  /** One URL saves the file, the other shows it in the browser. */
  private async _urls(row: AttachmentRow): Promise<{ url: string; previewUrl: string }> {
    const file = { key: row.objectKey, name: row.name, contentType: row.contentType }
    const [url, previewUrl] = await Promise.all([
      this.deps.files.downloadUrl(file),
      this.deps.files.downloadUrl({ ...file, inline: true })
    ])
    return { url, previewUrl }
  }

  private async _audit(tx: Database, { gate, card }: CardAccess, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: card.spaceId,
      actorId: gate.actor.id,
      entityType: 'card',
      entityId: card.id,
      action,
      changes
    })
  }
}
