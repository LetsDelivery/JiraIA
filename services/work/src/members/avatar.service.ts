import { ConflictException, ForbiddenException, type IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { FileStore, UploadTarget } from '../files/file-store.js'
import type { MemberRepository } from './member.repository.js'
import type { MemberViews } from './member-views.js'
import { AVATAR_EXTENSIONS, type AvatarFile, type MemberRow, type MemberView } from './schemas.js'

type Deps = {
  db: Database
  ids: IdGenerator
  access: AccessResolver
  audit: AuditTrail
  members: MemberRepository
  views: MemberViews
  files: FileStore
}

/**
 * A person's photo (ADR-0039), uploaded as a card's attachment is — the bytes go straight to storage —
 * but kept on the member: `start` hands back where to send it, `complete` checks it arrived and puts it
 * in place of the previous one, which is then deleted. Every card, comment and list shows it from then.
 */
export class AvatarService {
  constructor(private readonly deps: Deps) {}

  async start(caller: Caller, input: AvatarFile): Promise<{ id: string; upload: UploadTarget }> {
    const actor = await this._person(caller)
    const id = this.deps.ids.next()
    const upload = await this.deps.files.uploadUrl({ key: this._key(actor, id, input), ...input })
    return { id, upload }
  }

  /** The stored photo must be the one announced — same size — or nothing changes. */
  async complete(caller: Caller, avatarId: string, input: AvatarFile): Promise<MemberView> {
    const actor = await this._person(caller)
    const key = this._key(actor, avatarId, input)
    const stored = await this.deps.files.sizeOf(key)
    if (stored !== input.size) {
      throw new ConflictException(`Photo "${avatarId}" has not arrived yet`, { avatarId, stored: stored ?? 0 })
    }
    if (actor.avatarKey !== key) {
      await this._replace(actor, key, 'avatar_changed')
    }
    return await this.deps.views.one({ ...actor, avatarKey: key })
  }

  /** Back to the initials. */
  async remove(caller: Caller): Promise<MemberView> {
    const actor = await this._person(caller)
    if (actor.avatarKey) {
      await this._replace(actor, null, 'avatar_removed')
    }
    return await this.deps.views.one({ ...actor, avatarKey: null })
  }

  private async _replace(actor: MemberRow, key: string | null, action: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await this.deps.members.setAvatar(tx, actor.id, key)
      await this.deps.audit.record(tx, {
        organizationId: actor.organizationId,
        spaceId: null,
        actorId: actor.id,
        entityType: 'member',
        entityId: actor.id,
        action,
        changes: { avatar: { before: actor.avatarKey !== null, after: key !== null } }
      })
    })
    if (actor.avatarKey) {
      await this.deps.files.remove(actor.avatarKey)
    }
  }

  /** Only a person has a photo of their own; an agent's look is the admin's to give. */
  private async _person(caller: Caller): Promise<MemberRow> {
    const actor = await this.deps.access.actor(caller)
    if (actor.kind !== 'person') {
      throw new ForbiddenException(`Member "${actor.name}" is not a person and has no photo to change`)
    }
    return actor
  }

  /** Under the member's own prefix, so one person's upload can never become another's photo. */
  private _key(actor: MemberRow, avatarId: string, input: AvatarFile): string {
    return `${actor.organizationId}/avatars/${actor.id}/${avatarId}.${AVATAR_EXTENSIONS[input.contentType]}`
  }
}
