import { type Clock, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { JiraiaLogger } from '@jiraia/logger'
import { z } from 'zod'

import { cards } from '../schema.js'
import { type IssueRecord, type JiraProject, jiraProjectSchema } from './atlassian-source.js'
import { type CardInsert, ImportRepository, type Ref, type RefRow } from './import.repository.js'
import { ImportCatalogue } from './import-catalogue.js'
import { ImportMembers } from './import-members.js'
import type { ImportStore } from './import-store.js'
import { type CardContext, cardRowOf } from './jira-card-rows.js'
import { type CommentTally, JiraComments } from './jira-comments.js'
import {
  chunk,
  formerKeysOf,
  hashOf,
  isRank,
  isSprint,
  isStoryPoints,
  type JiraField,
  numberOf,
  parentKeyOf,
  statusOf
} from './jira-mapping.js'
import { inPool, manifestSchema } from './jira-raw-copy.js'
import { collectAccounts, type Person, personSchema } from './people.js'
import { PEOPLE_MAPPING } from './people-scan.js'

export type CardTally = { inserted: number; updated: number; unchanged: number; conflicts: string[] }
export type SpaceImportReport = {
  key: string
  cards: CardTally
  comments: CommentTally
  aliases: number
  /** `TEC-9→LD-4`: a parent in another project, which a space's hierarchy cannot hold. */
  parentsOutside: string[]
}
export type JiraImportReport = { run: string; rawRun: string; spaces: SpaceImportReport[]; unmappedAccounts: string[] }

type Deps = { db: Database; store: ImportStore; clock: Clock; ids: IdGenerator; logger: JiraiaLogger }
type Input = { organizationId: string; actorId: string; rawRun: string; run: string; projects: string[] }
type Loaded = { project: JiraProject; records: IssueRecord[] }
type Shared = { jiraFields: JiraField[]; mapping: Person[]; unmapped: Set<string> }
type CardPlan = {
  inserts: CardInsert[]
  updates: CardInsert[]
  refs: RefRow[]
  ids: Map<string, string>
  tally: CardTally
}

const BATCH = 25
const fieldListSchema = z.array(z.looseObject({ id: z.string(), name: z.string() }))

const rankOf = (record: IssueRecord, field: string | undefined): string =>
  field ? String((record.issue.fields as Record<string, unknown>)[field] ?? '') : String(record.issue.key)

/**
 * Etapa 8c (ADR-0036): writes a raw Jira copy into JiraIA — spaces, states, types, fields, sprints,
 * cards with Jira's own keys, authors and dates, their hierarchy and former keys, and comments. Every
 * row is remembered in `import_refs`, so running again updates what changed and skips the rest.
 */
export class JiraImport {
  private readonly repository: ImportRepository

  constructor(private readonly deps: Deps) {
    this.repository = new ImportRepository(deps.db)
  }

  async run(input: Input): Promise<JiraImportReport> {
    const prefix = `import/${input.rawRun}/jira`
    const shared: Shared = {
      jiraFields: fieldListSchema.parse(await this.deps.store.getJson(`${prefix}/fields.json`)) as JiraField[],
      mapping: z.array(personSchema).parse((await this.deps.store.getJson(PEOPLE_MAPPING)) ?? []),
      unmapped: new Set()
    }
    const spaces: SpaceImportReport[] = []
    for (const loaded of await this.load(input)) {
      spaces.push(await this.importProject(input, loaded, shared))
    }
    return { run: input.run, rawRun: input.rawRun, spaces, unmappedAccounts: [...shared.unmapped] }
  }

  private async load(input: Input): Promise<Loaded[]> {
    const prefix = `import/${input.rawRun}/jira`
    const manifest = await this.deps.store.getJson(`${prefix}/manifest.json`)
    if (manifest === undefined) {
      throw new NotFoundException('Import run', input.rawRun)
    }
    const entries = Object.values(manifestSchema.parse(manifest).issues)
    const projects = z.array(jiraProjectSchema).parse(await this.deps.store.getJson(`${prefix}/projects.json`))
    const loaded: Loaded[] = []
    for (const project of projects.filter((row) => input.projects.includes(row.key))) {
      const records: IssueRecord[] = []
      await inPool(
        entries.filter((entry) => entry.key.startsWith(`${project.key}-`)),
        16,
        async (entry) => {
          records.push((await this.deps.store.getJson(entry.path)) as IssueRecord)
        }
      )
      loaded.push({
        project,
        records: records.sort((a, b) => numberOf(String(a.issue.key)) - numberOf(String(b.issue.key)))
      })
    }
    return loaded
  }

  private async importProject(input: Input, loaded: Loaded, shared: Shared): Promise<SpaceImportReport> {
    const context = await this.contextOf(input, loaded, shared)
    const ordered = [...loaded.records].sort((a, b) =>
      rankOf(a, this.rankField(shared)).localeCompare(rankOf(b, this.rankField(shared)))
    )
    const plan = this.planCards(
      ordered,
      context,
      await this.repository.refs(input.organizationId, 'jira', 'card'),
      await this.repository.cardNumbers(context.catalogue.spaceId)
    )
    await this.writeCards(input.run, plan)
    const comments = new JiraComments({
      db: this.deps.db,
      repository: this.repository,
      clock: this.deps.clock,
      ids: this.deps.ids
    })
    const report: SpaceImportReport = {
      key: loaded.project.key,
      cards: plan.tally,
      parentsOutside: await this.linkParents(ordered, plan.ids),
      aliases: await this.writeAliases(input, ordered, plan.ids),
      comments: await comments.import({ run: input.run, records: ordered, cardIds: plan.ids, context })
    }
    await this.settle(input, context.catalogue.spaceId, report)
    this.deps.logger.info('Jira project imported', {
      project: report.key,
      inserted: report.cards.inserted,
      updated: report.cards.updated
    })
    return report
  }

  private rankField(shared: Shared): string | undefined {
    return shared.jiraFields.find(isRank)?.id
  }

  private async contextOf(input: Input, loaded: Loaded, shared: Shared): Promise<CardContext> {
    const at = this.deps.clock.now()
    const deps = { db: this.deps.db, repository: this.repository, ids: this.deps.ids }
    const seen = [...collectAccounts(loaded.records).values()]
    const people = await new ImportMembers(deps).ensure({
      organizationId: input.organizationId,
      run: input.run,
      at,
      mapping: shared.mapping,
      seen
    })
    for (const accountId of people.unmapped) {
      shared.unmapped.add(accountId)
    }
    const catalogue = await new ImportCatalogue(deps).ensure({
      organizationId: input.organizationId,
      project: loaded.project,
      records: loaded.records,
      jiraFields: shared.jiraFields,
      people,
      at
    })
    return {
      organizationId: input.organizationId,
      catalogue,
      people,
      actorId: input.actorId,
      storyPointsField: shared.jiraFields.find(isStoryPoints)?.id,
      sprintField: shared.jiraFields.find(isSprint)?.id
    }
  }

  /** Which issues are new, which changed and which are as last imported; ranks follow Jira's order. */
  private planCards(
    ordered: IssueRecord[],
    context: CardContext,
    refs: Map<string, Ref>,
    numbers: Map<number, string>
  ): CardPlan {
    const plan: CardPlan = {
      inserts: [],
      updates: [],
      refs: [],
      ids: new Map(),
      tally: { inserted: 0, updated: 0, unchanged: 0, conflicts: [] }
    }
    const perState = new Map<string, number>()
    for (const [index, record] of ordered.entries()) {
      this.planOne(record, refs.get(String(record.issue.id)), numbers, plan, () => {
        const stateId = context.catalogue.stateId.get(statusOf(record).name) ?? ''
        perState.set(stateId, (perState.get(stateId) ?? 0) + 1)
        return { rank: perState.get(stateId) ?? 1, backlogRank: index + 1, context }
      })
    }
    return plan
  }

  private planOne(
    record: IssueRecord,
    ref: Ref | undefined,
    numbers: Map<number, string>,
    plan: CardPlan,
    place: () => { rank: number; backlogRank: number; context: CardContext }
  ) {
    const key = String(record.issue.key)
    if (!ref && numbers.has(numberOf(key))) {
      plan.tally.conflicts.push(key)
      return
    }
    const id = ref?.targetId ?? this.deps.ids.next()
    plan.ids.set(key, id)
    const hash = hashOf(record)
    if (ref?.contentHash === hash) {
      plan.tally.unchanged += 1
      return
    }
    const { context, ...ranks } = place()
    ;(ref ? plan.updates : plan.inserts).push(cardRowOf(record, context, { id, ...ranks }))
    plan.tally[ref ? 'updated' : 'inserted'] += 1
    plan.refs.push({
      organizationId: context.organizationId,
      source: 'jira',
      entity: 'card',
      sourceId: String(record.issue.id),
      targetId: id,
      contentHash: hash,
      runId: '',
      importedAt: this.deps.clock.now()
    })
  }

  private async writeCards(run: string, plan: CardPlan): Promise<void> {
    const refOf = new Map(plan.refs.map((ref) => [ref.targetId, { ...ref, runId: run }]))
    for (const batch of chunk(plan.inserts, BATCH)) {
      await this.deps.db.transaction(async (tx) => {
        await tx.insert(cards).values(batch)
        await this.repository.putRefs(
          tx,
          batch.map((row) => refOf.get(String(row.id)) as RefRow)
        )
      })
    }
    for (const { id, organizationId: _o, spaceId: _s, number: _n, ...fields } of plan.updates) {
      await this.deps.db.transaction(async (tx) => {
        await this.repository.updateCard(tx, String(id), fields)
        await this.repository.putRefs(tx, [refOf.get(String(id)) as RefRow])
      })
    }
  }

  /** Sets every parent in the same space; answers the ones in another project. */
  private async linkParents(ordered: IssueRecord[], ids: Map<string, string>): Promise<string[]> {
    const links = ordered
      .map((record) => ({ key: String(record.issue.key), parent: parentKeyOf(record) }))
      .filter((link): link is { key: string; parent: string } => link.parent !== undefined && ids.has(link.key))
    const inside = links.filter((link) => ids.has(link.parent))
    for (const batch of chunk(inside, 500)) {
      await this.repository.setParents(
        this.deps.db,
        batch.map((link) => ({ id: ids.get(link.key) as string, parentId: ids.get(link.parent) as string }))
      )
    }
    return links.filter((link) => !ids.has(link.parent)).map((link) => `${link.key}→${link.parent}`)
  }

  private async writeAliases(input: Input, ordered: IssueRecord[], ids: Map<string, string>): Promise<number> {
    const rows = ordered.flatMap((record) =>
      formerKeysOf(record).map((former) => ({
        organizationId: input.organizationId,
        spaceKey: former.slice(0, former.lastIndexOf('-')),
        number: numberOf(former),
        cardId: ids.get(String(record.issue.key)) ?? '',
        createdAt: this.deps.clock.now()
      }))
    )
    const valid = rows.filter((row) => row.cardId !== '' && Number.isInteger(row.number))
    for (const batch of chunk(valid, 200)) {
      await this.repository.insertAliases(this.deps.db, batch)
    }
    return valid.length
  }

  /** Labels, the card counter and one audit event for the run — already dispatched, so nobody is notified. */
  private async settle(input: Input, spaceId: string, report: SpaceImportReport): Promise<void> {
    const at = this.deps.clock.now()
    await this.deps.db.transaction(async (tx) => {
      await this.repository.registerSpaceLabels(tx, spaceId)
      await this.repository.settleSpace(tx, spaceId)
      await this.repository.audit(tx, {
        id: this.deps.ids.next(),
        organizationId: input.organizationId,
        spaceId,
        actorId: input.actorId,
        entityType: 'space',
        entityId: spaceId,
        action: 'imported',
        changes: {
          run: { before: null, after: input.run },
          cards: { before: null, after: report.cards },
          comments: { before: null, after: report.comments }
        },
        occurredAt: at,
        dispatchedAt: at,
        via: 'Jira'
      })
    })
  }
}
