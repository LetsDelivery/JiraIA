/**
 * Where the bytes of attachments live (escopo-mvp 2.9), behind a type this service owns.
 *
 * The browser never sends a file through the API: it asks for an upload URL, sends the file straight
 * to storage, and reads it back by a short-lived download URL. In AWS that is S3 with pre-signed URLs
 * (`S3FileStore`); the suite and the local harness hand in their own.
 */
export type UploadTarget = { url: string; headers: Record<string, string> }

export type FileStore = {
  /** A URL the browser `PUT`s the file to, with these headers, for the next few minutes. */
  uploadUrl: (input: { key: string; contentType: string; size: number }) => Promise<UploadTarget>
  /** A URL that downloads the file under its original name, for the next few minutes. */
  downloadUrl: (input: { key: string; name: string; contentType: string }) => Promise<string>
  /** A URL an `<img>` shows the file from, valid for hours: a person's photo outlives a screen. */
  viewUrl: (input: { key: string; contentType: string }) => Promise<string>
  /** The size of the stored file, or `undefined` when nothing was uploaded under the key. */
  sizeOf: (key: string) => Promise<number | undefined>
  remove: (key: string) => Promise<void>
}

/**
 * Storage in a map — the suite's stand-in. `put` is what a browser's upload would have done.
 *
 * @example const files = new InMemoryFileStore(); await files.put(key, 120)
 */
export class InMemoryFileStore implements FileStore {
  readonly sizes = new Map<string, number>()

  async uploadUrl(input: { key: string; contentType: string }): Promise<UploadTarget> {
    return { url: `https://files.counterparty.test/${input.key}`, headers: { 'content-type': input.contentType } }
  }

  async downloadUrl(input: { key: string }): Promise<string> {
    return `https://files.counterparty.test/${input.key}?download`
  }

  async viewUrl(input: { key: string }): Promise<string> {
    return `https://files.counterparty.test/${input.key}?view`
  }

  async sizeOf(key: string): Promise<number | undefined> {
    return this.sizes.get(key)
  }

  async remove(key: string): Promise<void> {
    this.sizes.delete(key)
  }

  async put(key: string, size: number): Promise<void> {
    this.sizes.set(key, size)
  }
}
