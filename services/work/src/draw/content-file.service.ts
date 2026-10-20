import { type Clock, ConflictException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'
import { and, eq } from 'drizzle-orm'

import type { CreateAttachment } from '../cards/attachment.schemas.js'
import type { FileStore } from '../files/file-store.js'
import { contentFiles } from '../schema.js'
import type { DrawGate } from './draw-gate.js'

type Deps = { db: Database; clock: Clock; ids: IdGenerator; drawGate: DrawGate; files: FileStore }
type ContentFileRow = typeof contentFiles.$inferSelect

/**
 * Images and files in a page (escopo-mvp 5.2), uploaded as a card's are — the bytes go straight to
 * storage — and drawn by id: the editor asks for a fresh download URL each time (ADR-0009). Putting one
 * in a page is an edit of the page, recorded with its next version; the file itself is not audited.
 */
export class ContentFileService {
  constructor(private readonly deps: Deps) {}

  async start(caller: Caller, contentId: string, input: CreateAttachment) {
    const { gate, content } = await this.deps.drawGate.openDocument(caller, contentId, 'write')
    const id = this.deps.ids.next()
    const row: ContentFileRow = {
      id,
      contentId: content.id,
      ...input,
      objectKey: `${gate.actor.organizationId}/contents/${content.id}/${id}`,
      status: 'pending',
      uploadedBy: gate.actor.id,
      createdAt: this.deps.clock.now()
    }
    await this.deps.db.insert(contentFiles).values(row)
    const upload = await this.deps.files.uploadUrl({ key: row.objectKey, contentType: row.contentType, size: row.size })
    return { id, upload }
  }

  /** The stored file must be the one announced — same size — before the page may show it. */
  async complete(caller: Caller, contentId: string, fileId: string) {
    const { content } = await this.deps.drawGate.openDocument(caller, contentId, 'write')
    const file = await this._file(content.id, fileId)
    const stored = await this.deps.files.sizeOf(file.objectKey)
    if (stored !== file.size) {
      throw new ConflictException(`File "${file.name}" has not arrived yet`, { fileId, stored: stored ?? 0 })
    }
    await this.deps.db.update(contentFiles).set({ status: 'ready' }).where(eq(contentFiles.id, file.id))
    return await this.read(caller, contentId, fileId)
  }

  /** Where to read the file for the next few minutes, for anyone who reads the page. */
  async read(caller: Caller, contentId: string, fileId: string) {
    const { content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    const file = await this._file(content.id, fileId)
    if (file.status !== 'ready') {
      throw new NotFoundException('File', fileId)
    }
    const url = await this.deps.files.downloadUrl({
      key: file.objectKey,
      name: file.name,
      contentType: file.contentType
    })
    return { id: file.id, name: file.name, contentType: file.contentType, size: file.size, url }
  }

  private async _file(contentId: string, fileId: string): Promise<ContentFileRow> {
    const [file] = await this.deps.db
      .select()
      .from(contentFiles)
      .where(and(eq(contentFiles.contentId, contentId), eq(contentFiles.id, fileId)))
    if (!file) {
      throw new NotFoundException('File', fileId)
    }
    return file
  }
}
