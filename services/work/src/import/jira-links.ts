import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import type { LinkType } from '../cards/link.schemas.js'
import { cardLinks } from '../schema.js'
import type { IssueRecord, Raw } from './atlassian-source.js'
import type { ImportRepository, RefRow } from './import.repository.js'
import { chunk, fieldsOf, userOf } from './jira-mapping.js'

/**
 * Jira's link types as JiraIA's (escopo-mvp 2.7). `reverse` turns the link around: Jira Product
 * Discovery stores an idea as the one that "implements" its delivery, while JiraIA reads it from the
 * card that delivers — TEC delivers PRD, as the automation of Etapa 5a expects. Clones and
 * connections have no type of their own and relate.
 */
const TYPES: Record<string, { type: LinkType; reverse?: true }> = {
  Relates: { type: 'relates' },
  Blocks: { type: 'blocks' },
  Duplicate: { type: 'duplicates' },
  'Problem/Incident': { type: 'causes' },
  'Polaris work item link': { type: 'delivers', reverse: true },
  'Polaris datapoint work item link': { type: 'relates' },
  'Discovery - Connected': { type: 'relates' },
  Cloners: { type: 'relates' }
}

export type LinkTally = { inserted: number; unchanged: number; waiting: number }
type Deps = { db: Database; repository: ImportRepository; clock: Clock; ids: IdGenerator }
type Input = {
  organizationId: string
  run: string
  actorId: string
  records: IssueRecord[]
  memberOf: (accountId: string) => string | undefined
}
type Planned = { row: typeof cardLinks.$inferInsert; ref: RefRow }

type Made = { at: string; accountId: string | undefined }

const itemsOf = (entry: Raw): Raw[] => (Array.isArray(entry.items) ? (entry.items as Raw[]) : [])

/**
 * When and by whom each link was made, from the `Link` items of the changelogs, by `KEY>OTHER`. Jira
 * writes the item on one side or both, so a link is looked up from either.
 */
const linkHistoryOf = (records: IssueRecord[]): Map<string, Made> =>
  new Map(
    records.flatMap((record) =>
      record.changelog.flatMap((entry) =>
        itemsOf(entry)
          .filter((item) => item.field === 'Link' && typeof item.to === 'string')
          .map(
            (item) =>
              [
                `${record.issue.key}>${item.to}`,
                { at: String(entry.created), accountId: userOf(entry.author)?.accountId }
              ] as const
          )
      )
    )
  )

/** Every link of the records, once by Jira's id, with the issue it was read on. */
const linksOf = (records: IssueRecord[]): { link: Raw; record: IssueRecord }[] => {
  const seen = new Map<string, { link: Raw; record: IssueRecord }>()
  for (const record of records) {
    for (const link of (fieldsOf(record).issuelinks as Raw[] | undefined) ?? []) {
      seen.set(seen.has(String(link.id)) ? '' : String(link.id), { link, record })
    }
  }
  seen.delete('')
  return [...seen.values()]
}

/** Which card a link goes from and to, in JiraIA's reading; none while either card is not imported. */
const endsOf = (link: Raw, record: IssueRecord, cardOf: (issueId: string) => string | undefined) => {
  const kind = TYPES[String((link.type as Raw | undefined)?.name)] ?? { type: 'relates' as const }
  const other = (link.outwardIssue ?? link.inwardIssue) as Raw | undefined
  const here = cardOf(String(record.issue.id))
  const there = other ? cardOf(String(other.id)) : undefined
  if (!here || !there || !other) {
    return undefined
  }
  const forward = (link.outwardIssue !== undefined) !== (kind.reverse === true)
  return { type: kind.type, other, fromCardId: forward ? here : there, toCardId: forward ? there : here }
}

/**
 * Etapa 8c (ADR-0036): every Jira link between two imported cards, once — Jira repeats a link on both
 * issues — with the date and author its changelog gives. A link whose other card is in a project not
 * imported yet waits, and a later run brings it.
 */
export class JiraLinks {
  constructor(private readonly deps: Deps) {}

  async import(input: Input): Promise<LinkTally> {
    const cards = await this.deps.repository.refs(input.organizationId, 'jira', 'card')
    const done = await this.deps.repository.refs(input.organizationId, 'jira', 'link')
    const fresh = linksOf(input.records).filter(({ link }) => !done.has(String(link.id)))
    const cardOf = (issueId: string) => cards.get(issueId)?.targetId
    const history = linkHistoryOf(input.records)
    const planned = fresh
      .map(({ link, record }) => this.rowOf(link, record, history, input, cardOf))
      .filter((entry): entry is Planned => entry !== undefined)
    await this.write(planned)
    return { inserted: planned.length, unchanged: done.size, waiting: fresh.length - planned.length }
  }

  private rowOf(
    link: Raw,
    record: IssueRecord,
    history: Map<string, Made>,
    input: Input,
    cardOf: (issueId: string) => string | undefined
  ): Planned | undefined {
    const ends = endsOf(link, record, cardOf)
    if (!ends) {
      return undefined
    }
    const { fromCardId, toCardId, type, other } = ends
    const made = history.get(`${record.issue.key}>${other.key}`) ?? history.get(`${other.key}>${record.issue.key}`)
    const id = this.deps.ids.next()
    return {
      row: {
        id,
        organizationId: input.organizationId,
        type,
        fromCardId,
        toCardId,
        createdBy: (made?.accountId && input.memberOf(made.accountId)) || input.actorId,
        createdAt: made ? new Date(made.at) : this.deps.clock.now()
      },
      ref: {
        organizationId: input.organizationId,
        source: 'jira',
        entity: 'link',
        sourceId: String(link.id),
        targetId: id,
        contentHash: '',
        runId: input.run,
        importedAt: this.deps.clock.now()
      }
    }
  }

  private async write(planned: Planned[]): Promise<void> {
    for (const batch of chunk(planned, 100)) {
      await this.deps.db.transaction(async (tx) => {
        await tx
          .insert(cardLinks)
          .values(batch.map((entry) => entry.row))
          .onConflictDoNothing()
        await this.deps.repository.putRefs(
          tx,
          batch.map((entry) => entry.ref)
        )
      })
    }
  }
}
