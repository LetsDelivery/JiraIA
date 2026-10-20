import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { FileStore, UploadTarget } from './file-store.js'

/** Long enough to upload a large file on a slow link; short enough that a leaked URL soon expires. */
const UPLOAD_SECONDS = 15 * 60
const DOWNLOAD_SECONDS = 5 * 60

/**
 * Attachments in one private S3 bucket, reached only by pre-signed URLs.
 *
 * The upload URL is signed for the declared type and size, so the browser cannot store something else
 * under the key; the download URL names the original file, so it saves as `contrato.pdf`.
 */
export class S3FileStore implements FileStore {
  private readonly s3: S3Client

  constructor(private readonly config: { bucket: string; region: string }) {
    this.s3 = new S3Client({ region: config.region })
  }

  async uploadUrl(input: { key: string; contentType: string; size: number }): Promise<UploadTarget> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.size
    })
    const url = await getSignedUrl(this.s3, command, { expiresIn: UPLOAD_SECONDS })
    return { url, headers: { 'content-type': input.contentType } }
  }

  async downloadUrl(input: { key: string; name: string; contentType: string }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(input.name)}`
    })
    return await getSignedUrl(this.s3, command, { expiresIn: DOWNLOAD_SECONDS })
  }

  async sizeOf(key: string): Promise<number | undefined> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
      return head.ContentLength
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        return undefined
      }
      throw error
    }
  }

  async remove(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
  }
}
