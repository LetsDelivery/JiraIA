import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * Where the raw copy lives (ADR-0036): JSON documents under `import/<run>/…` in the migration bucket.
 * `S3ImportStore` is the real one; the suite hands in `InMemoryImportStore`.
 */
export type ImportStore = {
  putJson(key: string, value: unknown): Promise<void>
  /** The document under the key, or `undefined` when there is none. */
  getJson(key: string): Promise<unknown>
  putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** The text under the key, or `undefined` when there is none. */
  getText(key: string): Promise<string | undefined>
  /** Whether anything is stored under the key. */
  has(key: string): Promise<boolean>
}

/**
 * Documents in a map — the suite's stand-in.
 *
 * @example const store = new InMemoryImportStore(); await store.putJson('import/r1/x.json', {})
 */
export class InMemoryImportStore implements ImportStore {
  readonly documents = new Map<string, unknown>()

  async putJson(key: string, value: unknown): Promise<void> {
    this.documents.set(key, structuredClone(value))
  }

  async getJson(key: string): Promise<unknown> {
    return this.documents.get(key)
  }

  async putBytes(key: string, bytes: Uint8Array): Promise<void> {
    this.documents.set(key, bytes)
  }

  async getText(key: string): Promise<string | undefined> {
    const found = this.documents.get(key)
    return found instanceof Uint8Array ? new TextDecoder().decode(found) : undefined
  }

  async has(key: string): Promise<boolean> {
    return this.documents.has(key)
  }
}

/** The migration bucket: private, encrypted, versioned (`jiraia-import-<account>`, the stack's `ImportBucket`). */
export class S3ImportStore implements ImportStore {
  private readonly s3: S3Client

  constructor(private readonly config: { bucket: string; region: string }) {
    this.s3 = new S3Client({ region: config.region })
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
        ChecksumAlgorithm: 'SHA256'
      })
    )
  }

  async getJson(key: string): Promise<unknown> {
    const text = await this.getText(key)
    return text === undefined ? undefined : JSON.parse(text)
  }

  async getText(key: string): Promise<string | undefined> {
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }))
      return (await object.Body?.transformToString()) ?? ''
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return undefined
      }
      throw error
    }
  }

  async putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
        ChecksumAlgorithm: 'SHA256'
      })
    )
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
      return true
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        return false
      }
      throw error
    }
  }
}
