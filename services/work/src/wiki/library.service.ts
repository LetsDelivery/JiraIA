import { type Clock, toIso } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { DrawGate } from '../draw/draw-gate.js'
import type { MemberRow } from '../members/schemas.js'
import type { CollectionService, Readable } from './collection.service.js'
import type { PageLine, WikiPageRepository } from './page.repository.js'
import { DUE_SOON_DAYS, dueAfter, isOverdue, pageStateSchema } from './page.schemas.js'

type Deps = { clock: Clock; drawGate: DrawGate; collections: CollectionService; pages: WikiPageRepository }

const ids = (readable: readonly Readable[]) => readable.map((each) => each.space.id)

/**
 * The wiki's lists across collections (ADR-0034): what changed, what the caller opened, starred, was
 * given in someone's personal collection, and must review. Each reads only the collections the caller
 * reads, so a closed collection never shows through a list.
 */
export class LibraryService {
  constructor(private readonly deps: Deps) {}

  async recent(caller: Caller, limit: number) {
    const { readable } = await this._readable(caller)
    return this._lines(await this.deps.pages.recent(ids(readable), limit))
  }

  async opened(caller: Caller, limit: number) {
    const { actor, readable } = await this._readable(caller)
    return this._lines(await this.deps.pages.opened(actor.id, ids(readable), limit))
  }

  async favorites(caller: Caller) {
    const { actor, readable } = await this._readable(caller)
    return this._lines(await this.deps.pages.favorites(actor.id, ids(readable)))
  }

  /** "Compartilhadas comigo": pages of other people's personal collections the caller was given a role in. */
  async shared(caller: Caller, limit: number) {
    const { actor, readable } = await this._readable(caller)
    const others = readable.filter(
      (each) => each.collection.access === 'personal' && each.collection.ownerId !== actor.id
    )
    return this._lines(await this.deps.pages.topLevel(ids(others), limit))
  }

  /** The caller's official pages due within `DUE_SOON_DAYS` or past due, soonest first. */
  async reviews(caller: Caller) {
    const { actor, readable } = await this._readable(caller)
    const now = this.deps.clock.now()
    const rows = await this.deps.pages.dueFor(actor.id, dueAfter(now, DUE_SOON_DAYS), ids(readable))
    return {
      items: rows.flatMap(({ reviewDue, ...row }) =>
        reviewDue ? [{ ...row, reviewDue: toIso(reviewDue), overdue: reviewDue.getTime() < now.getTime() }] : []
      )
    }
  }

  private async _readable(caller: Caller): Promise<{ actor: MemberRow; readable: Readable[] }> {
    const actor = await this.deps.drawGate.actorOf(caller)
    return { actor, readable: await this.deps.collections.readable(actor) }
  }

  private _lines(rows: readonly PageLine[]) {
    const now = this.deps.clock.now()
    return {
      items: rows.map(({ state, reviewDue, updatedAt, ...row }) => ({
        ...row,
        state: pageStateSchema.parse(state ?? 'draft'),
        reviewDue: reviewDue ? toIso(reviewDue) : null,
        overdue: isOverdue(state ? { state, reviewDue } : undefined, now),
        updatedAt: toIso(updatedAt)
      }))
    }
  }
}
