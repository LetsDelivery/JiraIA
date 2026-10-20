import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { FileStore, UploadTarget } from '../../services/work/src/files/file-store.js'

/**
 * Attachments on this machine's disk, standing in for S3 (the second stand-in of the harness, after
 * Google). The "pre-signed" URLs are plain paths the harness itself answers, under the panel's `/api`
 * proxy, so the browser uploads and downloads exactly as it does against S3.
 */
export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  async uploadUrl(input: { key: string; contentType: string }): Promise<UploadTarget> {
    return { url: `/api/files/${input.key}`, headers: { 'content-type': input.contentType } }
  }

  async downloadUrl(input: { key: string; name: string; contentType: string }): Promise<string> {
    const query = new URLSearchParams({ name: input.name, type: input.contentType })
    return `/api/files/${input.key}?${query}`
  }

  async sizeOf(key: string): Promise<number | undefined> {
    return await stat(this.pathOf(key)).then(
      (found) => found.size,
      () => undefined
    )
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true })
  }

  /** `PUT /files/<key>` stores the body; `GET` returns it under its name. Keys never leave the root. */
  async serve(request: Request, key: string): Promise<Response> {
    const path = this.pathOf(key)
    if (request.method === 'PUT') {
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, await request.arrayBuffer())
      return new Response(null, { status: 200 })
    }
    const search = new URL(request.url).searchParams
    const name = encodeURIComponent(search.get('name') ?? 'arquivo')
    return new Response(Bun.file(path), {
      headers: {
        'content-type': search.get('type') ?? 'application/octet-stream',
        'content-disposition': `inline; filename*=UTF-8''${name}`
      }
    })
  }

  private pathOf(key: string): string {
    const path = resolve(this.root, key)
    if (!path.startsWith(resolve(this.root))) {
      throw new Error(`File key "${key}" leaves the local file root`)
    }
    return join(path)
  }
}
