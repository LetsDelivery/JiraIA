import { type Clock, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AuditTrail, Changes } from '../audit/audit.js'
import type { ContentRepository } from './content.repository.js'
import {
  type ContentRow,
  type DerivedContent,
  type SaveVersion,
  toVersionSummary,
  toVersionView,
  type VersionRow,
  type VersionView
} from './content.schemas.js'
import type { ContentAccess, DrawGate } from './draw-gate.js'
import type { VersionRepository } from './version.repository.js'
import { assertUpdate, mergeState } from './yjs-state.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  drawGate: DrawGate
  contents: ContentRepository
  versions: VersionRepository
}

/** Past this many stored updates, they are merged back into the page's document (ADR-0009). */
const COMPACT_AFTER = 50
/** A save takes a new version when the last one is older than this, or someone else's (5.4). */
const VERSION_EVERY_MS = 10 * 60_000

/**
 * A page's content (escopo-mvp 5.2–5.4): the Yjs state edited together, the JSON and text the editor
 * derives from it, and the versions. The realtime handler writes through `apply` as HTTP does.
 */
export class DocumentService {
  constructor(private readonly deps: Deps) {}

  async state(caller: Caller, contentId: string): Promise<{ state: string }> {
    const { content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    return { state: await this.currentState(content.id) }
  }

  /** Updates first, then the document: a compaction in between leaves updates in both, never neither. */
  async currentState(contentId: string): Promise<string> {
    const updates = await this.deps.contents.updates(contentId)
    const content = await this._page(contentId)
    return mergeState(
      content.document,
      updates.map((each) => each.update)
    )
  }

  async applyFromCaller(caller: Caller, contentId: string, update: string): Promise<{ state: string }> {
    const { gate, content } = await this.deps.drawGate.openDocument(caller, contentId, 'write')
    await this.apply(content.id, gate.actor.id, update)
    return { state: await this.currentState(content.id) }
  }

  /** Stores one change; every so often folds the stored changes into the document. */
  async apply(contentId: string, memberId: string, update: string): Promise<void> {
    assertUpdate(update, contentId)
    const now = this.deps.clock.now()
    await this.deps.contents.appendUpdate(this.deps.db, {
      id: this.deps.ids.next(),
      contentId,
      memberId,
      update,
      createdAt: now
    })
    const stored = await this.deps.contents.updates(contentId)
    if (stored.length > COMPACT_AFTER) {
      await this._compact(contentId)
    }
  }

  /** The page's row is locked, so two compactions never write over each other's document. */
  private async _compact(contentId: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      const document = await this.deps.contents.lockDocument(tx, contentId)
      const updates = await this.deps.contents.updates(contentId)
      const merged = mergeState(
        document,
        updates.map((each) => each.update)
      )
      await this.deps.contents.writeDocument(tx, contentId, merged)
      await this.deps.contents.dropUpdates(
        tx,
        updates.map((each) => each.id)
      )
    })
  }

  /** What the editor derived, kept for reading and search; a version is taken when one is due. */
  async saveContent(caller: Caller, contentId: string, derived: DerivedContent): Promise<{ version: number | null }> {
    const access = await this.deps.drawGate.openDocument(caller, contentId, 'write')
    const latest = await this.deps.versions.latest(access.content.id)
    const now = this.deps.clock.now()
    const due = _versionDue(latest, access.gate.actor.id, now) && derived.text !== latest?.contentText
    const fields = { contentJson: derived.json, contentText: derived.text, updatedBy: access.gate.actor.id }

    const version = await this.deps.db.transaction(async (tx) => {
      await this.deps.contents.update(tx, access.content.id, fields, now)
      return due ? await this._version(tx, access, { ...derived, reason: 'auto' }) : null
    })
    return { version }
  }

  async saveVersion(caller: Caller, contentId: string, input: SaveVersion = {}): Promise<VersionView> {
    const access = await this.deps.drawGate.openDocument(caller, contentId, 'write')
    const { content } = access
    const derived = { json: content.contentJson as Record<string, unknown>, text: content.contentText }
    const number = await this.deps.db.transaction(
      async (tx) => await this._version(tx, access, { ...derived, reason: 'manual', name: input.name ?? null })
    )
    return await this.version(caller, contentId, number)
  }

  async versions(caller: Caller, contentId: string) {
    const { content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    return { items: (await this.deps.versions.list(content.id)).map(toVersionSummary) }
  }

  async version(caller: Caller, contentId: string, number: number): Promise<VersionView> {
    const { content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    const found = await this.deps.versions.find(content.id, number)
    if (!found) {
      throw new NotFoundException('Version', `${content.title} v${number}`)
    }
    return toVersionView(found)
  }

  /**
   * Brings a version back: its content becomes the page's, recorded as a new version. The editor that
   * asked sets the same content in the live document, so it reaches everyone editing (ADR-0009).
   */
  async restore(caller: Caller, contentId: string, number: number): Promise<VersionView> {
    const access = await this.deps.drawGate.openDocument(caller, contentId, 'write')
    const old = await this.version(caller, contentId, number)
    const derived = { json: old.contentJson, text: old.contentText }
    const now = this.deps.clock.now()
    const restored = await this.deps.db.transaction(async (tx) => {
      const fields = { contentJson: derived.json, contentText: derived.text, updatedBy: access.gate.actor.id }
      await this.deps.contents.update(tx, access.content.id, fields, now)
      return await this._version(tx, access, { ...derived, reason: 'restore', restoredFrom: number })
    })
    return await this.version(caller, contentId, restored)
  }

  private async _version(
    tx: Database,
    { gate, content }: ContentAccess,
    input: DerivedContent & { reason: VersionRow['reason']; restoredFrom?: number; name?: string | null }
  ): Promise<number> {
    const number = await this.deps.versions.nextNumber(tx, content.id)
    await this.deps.versions.insert(tx, {
      id: this.deps.ids.next(),
      contentId: content.id,
      number,
      title: content.title,
      contentJson: input.json,
      contentText: input.text,
      document: await this.currentState(content.id),
      reason: input.reason,
      name: input.name ?? null,
      restoredFrom: input.restoredFrom ?? null,
      createdBy: gate.actor.id,
      createdAt: this.deps.clock.now()
    })
    const changes: Changes = { version: { before: number > 1 ? number - 1 : null, after: number } }
    await this.deps.audit.record(tx, {
      organizationId: gate.actor.organizationId,
      spaceId: content.spaceId,
      actorId: gate.actor.id,
      entityType: 'content',
      entityId: content.id,
      action: input.reason === 'restore' ? 'restored' : 'version_saved',
      changes: input.restoredFrom ? { ...changes, restoredFrom: { before: null, after: input.restoredFrom } } : changes
    })
    return number
  }

  private async _page(contentId: string): Promise<ContentRow> {
    const content = await this.deps.contents.byId(contentId)
    if (!content) {
      throw new NotFoundException('Content', contentId)
    }
    return content
  }
}

const _versionDue = (latest: VersionRow | undefined, memberId: string, now: Date): boolean =>
  !latest || latest.createdBy !== memberId || now.getTime() - latest.createdAt.getTime() >= VERSION_EVERY_MS
