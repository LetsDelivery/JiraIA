import { type Clock, ConflictException, type IdGenerator, toIso, ValidationException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import { type AuditTrail, type Changes, diff } from '../audit/audit.js'
import { rankAt } from '../cards/ranking.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { ContentRepository } from './content.repository.js'
import {
  type ContentRow,
  type ContentView,
  type CreateContent,
  contentKindSchema,
  type MoveContent,
  toContentNode
} from './content.schemas.js'
import type { ContentAccess, DrawAccess, DrawGate } from './draw-gate.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  drawGate: DrawGate
  contents: ContentRepository
  members: MemberRepository
}

type Tree = { items: ReturnType<typeof toContentNode>[] }

/**
 * A Let’s Draw AI space's content tree (escopo-mvp 5.1, ADR-0011): folders, pages and whiteboards —
 * create, rename, move under a folder or a page or reorder, delete. A page or whiteboard's own content
 * is the document service's; this one never touches it, except to put a first draft in a new one.
 */
export class ContentService {
  constructor(private readonly deps: Deps) {}

  async tree(caller: Caller, spaceId: string): Promise<Tree> {
    await this.deps.drawGate.space(caller, spaceId, 'read')
    return { items: (await this.deps.contents.tree(spaceId)).map(toContentNode) }
  }

  /** The pages and whiteboards changed last, in every space of the organization. */
  async recent(caller: Caller, limit: number) {
    const actor = await this.deps.drawGate.actorOf(caller)
    const rows = await this.deps.contents.recent(actor.organizationId, limit)
    return {
      items: rows.map((row) => ({
        ...toContentNode(row.content),
        spaceId: row.content.spaceId,
        spaceName: row.spaceName,
        spaceIcon: row.spaceIcon
      }))
    }
  }

  /** What the caller opened last, for "Abertos por você" (Etapa 4d-c). */
  async opened(caller: Caller, limit: number) {
    const actor = await this.deps.drawGate.actorOf(caller)
    const rows = await this.deps.contents.opened(actor.id, limit)
    return {
      items: rows.map((row) => ({
        ...toContentNode(row.content),
        spaceId: row.content.spaceId,
        spaceName: row.spaceName,
        spaceIcon: row.spaceIcon
      }))
    }
  }

  /** Notes that the caller opened a page or a whiteboard they can read. */
  async visit(caller: Caller, contentId: string): Promise<void> {
    const { gate, content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    await this.deps.contents.visit(gate.actor.id, content.id, this.deps.clock.now())
  }

  /** Lands last among its siblings; a draft — from a prompt — becomes its first content. */
  async create(caller: Caller, spaceId: string, input: CreateContent): Promise<ContentView> {
    const gate = await this.deps.drawGate.space(caller, spaceId, 'write')
    const parentId = input.parentId ?? null
    if (parentId) {
      await this._assertParent(caller, gate, parentId)
    }
    if (input.kind === 'folder' && input.draft) {
      throw new ValidationException(`Folder "${input.title}" holds content; it has none of its own`, {
        kind: input.kind
      })
    }
    const siblings = await this.deps.contents.positions(spaceId, parentId)
    const position =
      rankAt(
        siblings.map((each) => each.rank),
        siblings.length
      ) ?? 1
    const id = this.deps.ids.next()
    const row = _newContent({ id, gate, input, parentId, position, now: this.deps.clock.now() })

    await this.deps.db.transaction(async (tx) => {
      await this.deps.contents.insert(tx, row)
      await this._audit(tx, gate, id, 'created', diff({}, { kind: input.kind, title: input.title, parentId }))
    })
    return await this.read(caller, id)
  }

  async read(caller: Caller, contentId: string): Promise<ContentView> {
    return await this.view(await this.deps.drawGate.open(caller, contentId, 'read'))
  }

  /** A page or whiteboard as text, as the editor last derived it (ADR-0009) — what an agent reads (MCP). */
  async readText(caller: Caller, contentId: string) {
    const { content } = await this.deps.drawGate.open(caller, contentId, 'read')
    return {
      id: content.id,
      spaceId: content.spaceId,
      kind: content.kind,
      title: content.title,
      text: content.contentText,
      updatedAt: content.updatedAt.toISOString()
    }
  }

  async rename(caller: Caller, contentId: string, title: string): Promise<ContentView> {
    const { gate, content } = await this.deps.drawGate.open(caller, contentId, 'write')
    if (title !== content.title) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.contents.update(tx, content.id, { title, updatedBy: gate.actor.id }, this.deps.clock.now())
        await this._audit(tx, gate, content.id, 'renamed', { title: { before: content.title, after: title } })
      })
    }
    return await this.read(caller, contentId)
  }

  /** Under a folder or page of the same space, or at the top; never under itself or one of its own. */
  async move(caller: Caller, contentId: string, input: MoveContent): Promise<Tree> {
    const { gate, content } = await this.deps.drawGate.open(caller, contentId, 'write')
    if (input.parentId) {
      await this._assertParent(caller, gate, input.parentId, content.id)
    }
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      const siblings = await this.deps.contents.positions(content.spaceId, input.parentId, content.id)
      const position = await this._positionAt(tx, siblings, input.index)
      await this.deps.contents.update(
        tx,
        content.id,
        { parentId: input.parentId, position, updatedBy: gate.actor.id },
        now
      )
      if (input.parentId !== content.parentId) {
        await this._audit(tx, gate, content.id, 'moved', {
          parentId: { before: content.parentId, after: input.parentId }
        })
      }
    })
    return { items: (await this.deps.contents.tree(content.spaceId)).map(toContentNode) }
  }

  /** Content with content under it is not deleted: what is below would be lost from the tree. */
  async remove(caller: Caller, contentId: string): Promise<Tree> {
    const { gate, content } = await this.deps.drawGate.open(caller, contentId, 'write')
    const children = await this.deps.contents.childCount(content.id)
    if (children > 0) {
      throw new ConflictException(`"${content.title}" has ${children} items under it; move or delete them first`, {
        contentId
      })
    }
    const now = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.deps.contents.update(tx, content.id, { deletedAt: now, updatedBy: gate.actor.id }, now)
      await this._audit(tx, gate, content.id, 'deleted', { title: { before: content.title, after: null } })
    })
    return { items: (await this.deps.contents.tree(content.spaceId)).map(toContentNode) }
  }

  /** The content as a screen shows it, with the names of who created and last changed it. */
  async view({ gate, content }: ContentAccess): Promise<ContentView> {
    const [creator, editor] = await Promise.all([
      this._member(gate.actor, content.createdBy),
      this._member(gate.actor, content.updatedBy)
    ])
    return {
      ...toContentNode(content),
      spaceId: content.spaceId,
      contentJson: content.contentJson as Record<string, unknown>,
      createdBy: { id: content.createdBy, name: creator?.name ?? '' },
      updatedBy: { id: content.updatedBy, name: editor?.name ?? '' },
      createdAt: toIso(content.createdAt),
      canWrite: gate.canWrite
    }
  }

  private async _member(actor: MemberRow, id: string) {
    return await this.deps.members.findById(actor.organizationId, id)
  }

  /** A parent is a folder or page of the same space, and not the content itself nor anything below it. */
  private async _assertParent(caller: Caller, gate: DrawAccess, parentId: string, contentId?: string): Promise<void> {
    let current: ContentRow | undefined = (await this.deps.drawGate.open(caller, parentId, 'read')).content
    if (current.spaceId !== gate.space.id || current.kind === 'whiteboard') {
      throw new ValidationException(`"${current.title}" cannot hold content here`, { parentId })
    }
    for (let depth = 0; current && depth < 50; depth += 1) {
      if (current.id === contentId) {
        throw new ConflictException(`"${current.title}" is below this content; it cannot be its parent`, { parentId })
      }
      current = current.parentId
        ? await this.deps.contents.find(gate.actor.organizationId, current.parentId)
        : undefined
    }
  }

  private async _positionAt(tx: Database, siblings: { id: string; rank: number }[], index: number): Promise<number> {
    const position = rankAt(
      siblings.map((each) => each.rank),
      index
    )
    if (position !== undefined) {
      return position
    }
    await this.deps.contents.renumber(
      tx,
      siblings.map((each) => each.id)
    )
    return rankAt(
      siblings.map((_, at) => at + 1),
      index
    ) as number
  }

  private async _audit(tx: Database, gate: DrawAccess, contentId: string, action: string, changes: Changes) {
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: gate.space.id,
      actorId: gate.actor.id,
      entityType: 'content',
      entityId: contentId,
      action,
      changes
    })
  }
}

type NewContent = {
  id: string
  gate: DrawAccess
  input: CreateContent
  parentId: string | null
  position: number
  now: Date
}

const _newContent = ({ id, gate, input, parentId, position, now }: NewContent): ContentRow => ({
  id,
  organizationId: gate.actor.organizationId,
  spaceId: gate.space.id,
  parentId,
  kind: contentKindSchema.parse(input.kind),
  title: input.title,
  position,
  document: '',
  contentJson: input.draft?.json ?? {},
  contentText: input.draft?.text ?? '',
  createdBy: gate.actor.id,
  updatedBy: gate.actor.id,
  createdAt: now,
  updatedAt: now,
  deletedAt: null
})
