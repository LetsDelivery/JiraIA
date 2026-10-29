import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { CopyObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * Where an imported attachment's bytes go: from the migration bucket, where the raw copy keeps them
 * (`import/jira/attachments/<id>`), to the key the card's attachment reads (ADR-0036).
 */
export type AttachmentFiles = {
  copy(input: { from: string; to: string; contentType: string }): Promise<void>
}

/** Copies kept in a list — the suite's stand-in. */
export class InMemoryAttachmentFiles implements AttachmentFiles {
  readonly copies: { from: string; to: string }[] = []

  async copy(input: { from: string; to: string }): Promise<void> {
    this.copies.push({ from: input.from, to: input.to })
  }
}

/** A copy inside S3, from bucket to bucket: the bytes never leave AWS. */
export class S3AttachmentFiles implements AttachmentFiles {
  private readonly s3: S3Client

  constructor(private readonly config: { importBucket: string; attachmentsBucket: string; region: string }) {
    this.s3 = new S3Client({ region: config.region })
  }

  async copy(input: { from: string; to: string; contentType: string }): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        CopySource: `${this.config.importBucket}/${encodeURIComponent(input.from).replaceAll('%2F', '/')}`,
        Bucket: this.config.attachmentsBucket,
        Key: input.to,
        ContentType: input.contentType,
        MetadataDirective: 'REPLACE',
        ServerSideEncryption: 'AES256'
      })
    )
  }
}

/**
 * The local harness's disk (`LOCAL_FILES_DIR`), where `local:serve` keeps attachments: the bytes are
 * read from the migration bucket and written under the key, so an imported card opens its files locally.
 */
export class DiskAttachmentFiles implements AttachmentFiles {
  private readonly s3: S3Client

  constructor(private readonly config: { importBucket: string; root: string; region: string }) {
    this.s3 = new S3Client({ region: config.region })
  }

  async copy(input: { from: string; to: string }): Promise<void> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.config.importBucket, Key: input.from }))
    const path = join(resolve(this.config.root), input.to)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, (await object.Body?.transformToByteArray()) ?? new Uint8Array())
  }
}
