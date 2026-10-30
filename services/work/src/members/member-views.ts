import type { FileStore } from '../files/file-store.js'
import { AVATAR_EXTENSIONS, type MemberRow, type MemberView, toMemberView } from './schemas.js'

const TYPE_OF_EXTENSION = Object.fromEntries(Object.entries(AVATAR_EXTENSIONS).map(([type, ext]) => [ext, type]))

/** The content type of a stored photo, read back from its key's extension (`….webp`). */
export const avatarContentType = (key: string): string =>
  TYPE_OF_EXTENSION[key.slice(key.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

/** Members as the API shows them: each with a URL of their photo, signed when the view is made. */
export class MemberViews {
  constructor(private readonly files: FileStore) {}

  async one(row: MemberRow): Promise<MemberView> {
    const avatarUrl = row.avatarKey
      ? await this.files.viewUrl({ key: row.avatarKey, contentType: avatarContentType(row.avatarKey) })
      : null
    return toMemberView(row, avatarUrl)
  }

  async many(rows: readonly MemberRow[]): Promise<MemberView[]> {
    return await Promise.all(rows.map((row) => this.one(row)))
  }
}
