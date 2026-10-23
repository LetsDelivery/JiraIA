import type { ContentRepository } from '../draw/content.repository.js'
import type { ContentCommentRepository } from '../draw/content-comment.repository.js'
import type { DrawSpaceRepository } from '../draw/draw-space.repository.js'
import type { VersionRepository } from '../draw/version.repository.js'
import type { DomainEvent } from '../events/event.js'
import type { MemberRepository } from '../members/member.repository.js'
import { excerpt } from './excerpt.js'
import type { Notice } from './fanout.js'
import type { NotificationRepository } from './notification.repository.js'

type Deps = {
  contents: ContentRepository
  comments: ContentCommentRepository
  versions: VersionRepository
  spaces: DrawSpaceRepository
  notifications: NotificationRepository
  members: MemberRepository
}

/** The Draw events someone hears about (Etapa 5f): a mention in a comment, and a new version. */
export const DRAW_EVENTS = new Set(['content_comment.commented', 'content.version_saved', 'content.restored'])

/**
 * Who hears about LET’S Draw AI. A mention in a comment reaches whoever was named; a version saved
 * reaches everyone else who helped write the page — once until they read it, however many versions
 * follow, since the morning summary names every editor anyway.
 */
export class DrawNotices {
  constructor(private readonly deps: Deps) {}

  async notices(event: DomainEvent): Promise<Notice[]> {
    return event.entityType === 'content_comment' ? await this._mentioned(event) : await this._changed(event)
  }

  private async _mentioned(event: DomainEvent): Promise<Notice[]> {
    const comment = await this.deps.comments.byId(event.entityId)
    const content = comment ? await this.deps.contents.find(event.organizationId, comment.contentId) : undefined
    if (!comment || !content) {
      return []
    }
    const base = await this._base(event, content)
    const data = { ...base.data, excerpt: await excerpt(this.deps.members, event.organizationId, comment.body) }
    const mentioned = (comment.mentions as string[]) ?? []
    return mentioned.map((memberId) => ({ ...base, data, memberId, kind: 'draw_mentioned' as const }))
  }

  private async _changed(event: DomainEvent): Promise<Notice[]> {
    const content = await this.deps.contents.find(event.organizationId, event.entityId)
    if (!content) {
      return []
    }
    const [authors, waiting] = await Promise.all([
      this.deps.versions.authors(content.id),
      this.deps.notifications.waitingOn('content_changed', content.id)
    ])
    const base = await this._base(event, content)
    return [...new Set([content.createdBy, ...authors])]
      .filter((memberId) => !waiting.includes(memberId))
      .map((memberId) => ({ ...base, memberId, kind: 'content_changed' as const }))
  }

  private async _base(event: DomainEvent, content: { id: string; spaceId: string; title: string; kind: string }) {
    const space = await this.deps.spaces.find(event.organizationId, content.spaceId)
    return {
      cardId: null,
      spaceId: content.spaceId,
      data: {
        product: 'draw' as const,
        spaceName: space?.name ?? '',
        contentId: content.id,
        contentTitle: content.title,
        contentKind: content.kind
      }
    }
  }
}
