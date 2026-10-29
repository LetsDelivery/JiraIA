import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { cardAttachments } from '../schema.js'
import type { IssueRecord, Raw } from './atlassian-source.js'
import type { AttachmentFiles } from './attachment-files.js'
import type { ImportRepository, RefRow } from './import.repository.js'
import { attachmentKey } from './jira-attachment-copy.js'
import { chunk, fieldsOf, userOf } from './jira-mapping.js'
import { inPool } from './jira-raw-copy.js'

/** `missing`: Jira attachments whose bytes the raw copy lacks — run `jira-attachments` on that run. */
export type AttachmentTally = { inserted: number; unchanged: number; bytes: number; missing: string[] }
type Deps = { db: Database; repository: ImportRepository; files: AttachmentFiles; clock: Clock; ids: IdGenerator }
type Input = {
  organizationId: string
  run: string
  actorId: string
  records: IssueRecord[]
  cardIds: Map<string, string>
  memberOf: (accountId: string) => string | undefined
}
type Planned = { row: typeof cardAttachments.$inferInsert; ref: RefRow; from: string }

/** S3's answer for a key that is not there, from a copy or a read. */
const isMissing = (error: unknown): boolean =>
  ['NoSuchKey', 'NotFound'].includes(String((error as { name?: string }).name))

/** The content types an attachment may carry (attachment.schemas.ts); anything else is a plain file. */
const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/

const contentTypeOf = (attachment: Raw): string => {
  const type =
    String(attachment.mimeType ?? '')
      .split(';')[0]
      ?.trim() ?? ''
  return CONTENT_TYPE.test(type) ? type : 'application/octet-stream'
}

/**
 * Etapa 8c (ADR-0036): every Jira attachment becomes one of its card's, with Jira's name, author and
 * date. The bytes are copied from the raw copy inside S3; the row is written only after its copy, so
 * a run that stops halfway leaves no attachment without a file, and the next run finishes it.
 */
export class JiraAttachments {
  constructor(private readonly deps: Deps) {}

  async import(input: Input): Promise<AttachmentTally> {
    const done = await this.deps.repository.refs(input.organizationId, 'jira', 'attachment')
    const planned = input.records.flatMap((record) => this.plan(record, input, done))
    const copied: Planned[] = []
    const missing: string[] = []
    await inPool(planned, 8, async (entry) => {
      try {
        await this.deps.files.copy({
          from: entry.from,
          to: String(entry.row.objectKey),
          contentType: String(entry.row.contentType)
        })
        copied.push(entry)
      } catch (error) {
        if (!isMissing(error)) {
          throw error
        }
        missing.push(entry.ref.sourceId)
      }
    })
    for (const batch of chunk(copied, 100)) {
      await this.deps.db.transaction(async (tx) => {
        await tx.insert(cardAttachments).values(batch.map((entry) => entry.row))
        await this.deps.repository.putRefs(
          tx,
          batch.map((entry) => entry.ref)
        )
      })
    }
    const bytes = copied.reduce((sum, entry) => sum + Number(entry.row.size), 0)
    return { inserted: copied.length, unchanged: done.size, bytes, missing }
  }

  private plan(record: IssueRecord, input: Input, done: Map<string, unknown>): Planned[] {
    const cardId = input.cardIds.get(String(record.issue.key))
    const attachments = (fieldsOf(record).attachment as Raw[] | undefined) ?? []
    return cardId
      ? attachments.filter((each) => !done.has(String(each.id))).map((each) => this.rowOf(each, cardId, input))
      : []
  }

  private rowOf(attachment: Raw, cardId: string, input: Input): Planned {
    const id = this.deps.ids.next()
    const author = userOf(attachment.author)
    const row = {
      id,
      cardId,
      name: String(attachment.filename ?? 'anexo').slice(0, 255),
      contentType: contentTypeOf(attachment),
      size: Number(attachment.size) || 0,
      objectKey: `${input.organizationId}/${cardId}/${id}`,
      status: 'ready',
      uploadedBy: (author && input.memberOf(author.accountId)) || input.actorId,
      createdAt: new Date(String(attachment.created))
    }
    const ref = {
      organizationId: input.organizationId,
      source: 'jira',
      entity: 'attachment',
      sourceId: String(attachment.id),
      targetId: id,
      contentHash: '',
      runId: input.run,
      importedAt: this.deps.clock.now()
    }
    return { row, ref, from: attachmentKey(String(attachment.id)) }
  }
}
