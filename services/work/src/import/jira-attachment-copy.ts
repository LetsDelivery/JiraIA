import { NotFoundException } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

import type { AtlassianSource } from './atlassian-source.js'
import type { ImportStore } from './import-store.js'
import { inPool, type Manifest, manifestSchema } from './jira-raw-copy.js'

const attachmentSchema = z.looseObject({
  id: z.string(),
  filename: z.string(),
  size: z.number(),
  mimeType: z.string().optional()
})
type Attachment = z.infer<typeof attachmentSchema>

const issueFileSchema = z.object({
  issue: z.object({ fields: z.looseObject({ attachment: z.array(attachmentSchema).optional() }) })
})

export type AttachmentReport = {
  run: string
  attachments: number
  copied: number
  alreadyStored: number
  bytes: number
  /** Attachments whose bytes did not match the size Jira declared; stored anyway, listed for a look. */
  sizeMismatch: string[]
}

/** An attachment never changes under its id, so it lives once, outside any run. */
export const attachmentKey = (id: string): string => `import/jira/attachments/${id}`

type Deps = { source: AtlassianSource; store: ImportStore; logger: JiraiaLogger; concurrency?: number }

/**
 * Etapa 8a: the bytes of every attachment of a run's issues, beside the raw copy (ADR-0036). One
 * already stored is not asked for again, so a later run downloads only what is new.
 */
export class JiraAttachmentCopy {
  constructor(private readonly deps: Deps) {}

  async run(run: string): Promise<AttachmentReport> {
    const files = await this.attachmentsOf(await this.manifestOf(run))
    const report: AttachmentReport = {
      run,
      attachments: files.length,
      copied: 0,
      alreadyStored: 0,
      bytes: 0,
      sizeMismatch: []
    }
    await inPool(files, this.deps.concurrency ?? 6, (file) => this.copyOne(file, report))
    await this.deps.store.putJson(`import/${run}/jira/attachments-report.json`, report)
    this.deps.logger.info('Jira attachments copied', {
      run,
      copied: report.copied,
      alreadyStored: report.alreadyStored
    })
    return report
  }

  private async manifestOf(run: string): Promise<Manifest> {
    const found = await this.deps.store.getJson(`import/${run}/jira/manifest.json`)
    if (found === undefined) {
      throw new NotFoundException('Import run', run)
    }
    return manifestSchema.parse(found)
  }

  private async attachmentsOf(manifest: Manifest): Promise<Attachment[]> {
    const files: Attachment[] = []
    for (const entry of Object.values(manifest.issues).filter((issue) => issue.tally.attachments > 0)) {
      const record = issueFileSchema.parse(await this.deps.store.getJson(entry.path))
      files.push(...(record.issue.fields.attachment ?? []))
    }
    return files
  }

  private async copyOne(file: Attachment, report: AttachmentReport): Promise<void> {
    if (await this.deps.store.has(attachmentKey(file.id))) {
      report.alreadyStored += 1
      return
    }
    const bytes = await this.deps.source.attachment(file.id)
    await this.deps.store.putBytes(attachmentKey(file.id), bytes, file.mimeType ?? 'application/octet-stream')
    report.copied += 1
    report.bytes += bytes.length
    if (bytes.length !== file.size) {
      report.sizeMismatch.push(file.id)
    }
  }
}
