import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { cardComments } from '../schema.js'
import type { IssueRecord, Raw } from './atlassian-source.js'
import type { CommentInsert, ImportRepository, Ref, RefRow } from './import.repository.js'
import { type CardContext, commentRowOf } from './jira-card-rows.js'
import { chunk, hashOf } from './jira-mapping.js'

export type CommentTally = { inserted: number; updated: number; unchanged: number }
type Entry = { row: CommentInsert; ref: RefRow }
type Plan = { inserts: Entry[]; updates: Entry[]; unchanged: number }
type Deps = { db: Database; repository: ImportRepository; clock: Clock; ids: IdGenerator }

const BATCH = 50

/** Etapa 8c: a card's Jira comments, with their authors and dates, remembered in `import_refs`. */
export class JiraComments {
  constructor(private readonly deps: Deps) {}

  async import(input: { run: string; records: IssueRecord[]; cardIds: Map<string, string>; context: CardContext }) {
    const refs = await this.deps.repository.refs(input.context.organizationId, 'jira', 'comment')
    const plan: Plan = { inserts: [], updates: [], unchanged: 0 }
    for (const record of input.records) {
      const cardId = input.cardIds.get(String(record.issue.key))
      for (const comment of cardId ? record.comments : []) {
        this.planOne(comment, cardId as string, refs.get(String(comment.id)), input, plan)
      }
    }
    await this.write(plan)
    return { inserted: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchanged }
  }

  private planOne(
    comment: Raw,
    cardId: string,
    ref: Ref | undefined,
    input: { run: string; context: CardContext },
    plan: Plan
  ) {
    const hash = hashOf(comment)
    if (ref?.contentHash === hash) {
      plan.unchanged += 1
      return
    }
    const row = commentRowOf(comment, cardId, ref?.targetId ?? this.deps.ids.next(), input.context)
    const entry = {
      row,
      ref: {
        organizationId: input.context.organizationId,
        source: 'jira',
        entity: 'comment',
        sourceId: String(comment.id),
        targetId: String(row.id),
        contentHash: hash,
        runId: input.run,
        importedAt: this.deps.clock.now()
      }
    }
    ;(ref ? plan.updates : plan.inserts).push(entry)
  }

  private async write(plan: Plan): Promise<void> {
    for (const batch of chunk(plan.inserts, BATCH)) {
      await this.deps.db.transaction(async (tx) => {
        await tx.insert(cardComments).values(batch.map((entry) => entry.row))
        await this.deps.repository.putRefs(
          tx,
          batch.map((entry) => entry.ref)
        )
      })
    }
    for (const entry of plan.updates) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.repository.updateComment(tx, String(entry.row.id), entry.row)
        await this.deps.repository.putRefs(tx, [entry.ref])
      })
    }
  }
}
