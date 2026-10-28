import { beforeEach, describe, expect, it } from 'bun:test'
import { fixedClock, uuidGenerator } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'
import { testDatabase, truncateSchema } from '@jiraia/testing'
import { and, eq, isNull } from 'drizzle-orm'

import { fakeIssue } from '../import/atlassian-source.js'
import { InMemoryImportStore } from '../import/import-store.js'
import { JiraImport } from '../import/jira-import.js'
import type { Person } from '../import/people.js'
import { PEOPLE_MAPPING } from '../import/people-scan.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import {
  auditEvents,
  cardComments,
  cardKeyAliases,
  cards,
  members,
  spaces,
  sprints,
  workflowStates
} from '../schema.js'

/**
 * Etapa 8c: a raw Jira copy becomes spaces and cards with Jira's own keys, authors and dates, and a
 * second run changes only what Jira changed (ADR-0036).
 */
const db = await testDatabase('services/work/drizzle')
const clock = fixedClock(new Date('2026-10-28T20:00:00.000Z'))

const ANA = '712020:00000000-0000-4000-8000-00000000000a'
const LIA = '712020:00000000-0000-4000-8000-00000000000d'
const user = (accountId: string, displayName: string) => ({ accountId, displayName, active: true })
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

const mapping: Person[] = [
  {
    accountId: ANA,
    name: 'Ana Souza',
    email: 'ana@uselets.com',
    active: true,
    occurrences: 3,
    member: 'ana@uselets.com',
    rule: 'own-email'
  },
  { accountId: LIA, name: 'Lia Antiga', email: '', active: false, occurrences: 1, member: null, rule: 'name-only' }
]

const issue = (
  id: string,
  key: string,
  fields: Record<string, unknown>,
  extra: Parameters<typeof fakeIssue>[0] = { id, key, project: 'TEC', updated: '' }
) =>
  fakeIssue({
    ...extra,
    id,
    key,
    project: 'TEC',
    updated: String(fields.updated),
    issue: {
      id,
      key,
      fields: { project: { key: 'TEC' }, issuetype: { name: 'História' }, priority: { name: 'High' }, ...fields }
    }
  })

const epic = issue('100', 'TEC-216', {
  summary: 'Ajustar cobranças',
  status: { name: 'IMPEDIMENTO', statusCategory: { key: 'new' } },
  issuetype: { name: 'Epic' },
  reporter: user(LIA, 'Lia Antiga'),
  created: '2024-05-21T14:46:44.781-0300',
  updated: '2026-02-23T10:24:23.384-0300',
  description: doc('Depende do webhook'),
  labels: ['okr-q4'],
  customfield_10019: '0|i0001:'
})
const story = issue(
  '101',
  'TEC-3538',
  {
    summary: 'Nova tela',
    status: { name: 'DOWNSTREAM', statusCategory: { key: 'indeterminate' } },
    reporter: user(ANA, 'Ana Souza'),
    assignee: user(ANA, 'Ana Souza'),
    parent: { key: 'TEC-216' },
    created: '2026-10-27T17:32:27.990-0300',
    updated: '2026-10-27T18:00:00.000-0300',
    description: doc('Faz a tela'),
    customfield_10019: '0|i0000:'
  },
  {
    id: '101',
    key: 'TEC-3538',
    project: 'TEC',
    updated: '',
    changelog: [{ id: '1', items: [{ field: 'Key', fromString: 'LD-17', toString: 'TEC-3538' }] }],
    comments: [
      {
        id: 'c1',
        author: user(ANA, 'Ana Souza'),
        body: doc('Revisa?'),
        created: '2026-10-27T19:00:00.000-0300',
        updated: '2026-10-27T19:05:00.000-0300'
      }
    ]
  }
)

const fields = [
  {
    id: 'customfield_10019',
    name: 'Classificação',
    custom: true,
    schema: { custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' }
  },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  {
    id: 'customfield_10016',
    name: 'Story point estimate',
    custom: true,
    schema: { custom: 'com.pyxis.greenhopper.jira:jsw-story-points' }
  }
]

let store: InMemoryImportStore
let actorId: string
let organizationId: string

const importer = () => new JiraImport({ db, store, clock, ids: uuidGenerator, logger: createLogger('work', 'import') })
const run = (id: string) => importer().run({ organizationId, actorId, rawRun: 'raw1', run: id, projects: ['TEC'] })
const card = async (number: number) => {
  const [row] = await db.select().from(cards).where(eq(cards.number, number))
  return row
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  const admin = await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'stenio@uselets.com', name: 'Stênio' } }
  )
  actorId = admin.id
  organizationId = admin.organizationId
  store = new InMemoryImportStore()
  await store.putJson('import/raw1/jira/projects.json', [
    { id: '10132', key: 'TEC', name: 'Delivery Board', projectTypeKey: 'software' }
  ])
  await store.putJson('import/raw1/jira/fields.json', fields)
  await store.putJson(PEOPLE_MAPPING, mapping)
  await store.putJson('import/raw1/jira/issues/100.json', epic)
  await store.putJson('import/raw1/jira/issues/101.json', story)
  await store.putJson('import/raw1/jira/manifest.json', {
    run: 'raw1',
    issues: {
      '100': {
        key: 'TEC-216',
        updated: '',
        path: 'import/raw1/jira/issues/100.json',
        tally: { comments: 0, changes: 0, worklogs: 0, attachments: 0, attachmentBytes: 0, links: 0 }
      },
      '101': {
        key: 'TEC-3538',
        updated: '',
        path: 'import/raw1/jira/issues/101.json',
        tally: { comments: 1, changes: 1, worklogs: 0, attachments: 0, attachmentBytes: 0, links: 0 }
      }
    }
  })
})

describe('Jira import', () => {
  it('creates the space with every status its cards use, and keeps Jira’s keys, dates and authors', async () => {
    const report = await run('i1')

    expect(report.spaces[0]?.cards).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 })
    const [space] = await db.select().from(spaces).where(eq(spaces.key, 'TEC'))
    const states = await db
      .select()
      .from(workflowStates)
      .where(eq(workflowStates.spaceId, String(space?.id)))
    expect(states.map((state) => [state.name, state.group]).sort()).toEqual([
      ['DOWNSTREAM', 'in_progress'],
      ['IMPEDIMENTO', 'not_started']
    ])
    const newest = await card(3538)
    expect(newest).toMatchObject({ title: 'Nova tela', description: 'Faz a tela', priority: 'high' })
    expect(newest?.createdAt.toISOString()).toBe('2026-10-27T20:32:27.990Z')
    expect(space?.nextCardNumber).toBe(3539)
  })

  it('makes whoever left an inactive member with no e-mail, and invites whoever never signed in', async () => {
    await run('i1')
    const lia = (await db.select().from(members).where(eq(members.name, 'Lia Antiga')))[0]
    const ana = (await db.select().from(members).where(eq(members.email, 'ana@uselets.com')))[0]

    expect(lia).toMatchObject({ status: 'inactive', email: null, subject: null })
    expect(ana).toMatchObject({ status: 'active', subject: null })
    expect((await card(216))?.reporterId).toBe(String(lia?.id))
    expect((await card(3538))?.assigneeId).toBe(String(ana?.id))
  })

  it('keeps the hierarchy, the former key and the comments with their authors and edit dates', async () => {
    await run('i1')
    const [epicRow, storyRow] = [await card(216), await card(3538)]
    const [alias] = await db
      .select()
      .from(cardKeyAliases)
      .where(and(eq(cardKeyAliases.spaceKey, 'LD'), eq(cardKeyAliases.number, 17)))
    const [comment] = await db
      .select()
      .from(cardComments)
      .where(eq(cardComments.cardId, String(storyRow?.id)))

    expect(storyRow?.parentId).toBe(String(epicRow?.id))
    expect(alias?.cardId).toBe(String(storyRow?.id))
    expect(comment).toMatchObject({ body: 'Revisa?' })
    expect(comment?.editedAt?.toISOString()).toBe('2026-10-27T22:05:00.000Z')
    expect(epicRow?.labels).toEqual(['okr-q4'])
  })

  it('leaves one audit event for the run, already dispatched so nobody is notified about the past', async () => {
    const pending = async () => (await db.select().from(auditEvents).where(isNull(auditEvents.dispatchedAt))).length
    const before = await pending()
    await run('i1')
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, 'imported'))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actorId, via: 'Jira', entityType: 'space' })
    expect(await pending()).toBe(before)
  })

  it('brings Jira’s sprints with their numbers, states and São Paulo dates, and puts each card in its last one', async () => {
    const sprint = (id: number, name: string, state: string) => ({
      id,
      name,
      state,
      startDate: '2026-10-20T12:00:00.000Z',
      endDate: '2026-11-03T12:00:00.000Z'
    })
    const inSprints = {
      ...story,
      issue: {
        ...story.issue,
        fields: {
          ...(story.issue.fields as object),
          customfield_10020: [sprint(1, 'Sprint 31', 'closed'), sprint(2, 'Sprint 32', 'active')],
          customfield_10016: 5
        }
      }
    }
    await store.putJson('import/raw1/jira/issues/101.json', inSprints)
    await run('i1')
    const [space] = await db.select().from(spaces).where(eq(spaces.key, 'TEC'))
    const rows = await db
      .select()
      .from(sprints)
      .where(eq(sprints.spaceId, String(space?.id)))

    expect(rows.map((row) => [row.number, row.state, row.startsOn]).sort()).toEqual([
      [31, 'closed', '2026-10-20'],
      [32, 'active', '2026-10-20']
    ])
    expect((await card(3538))?.sprintId).toBe(String(rows.find((row) => row.number === 32)?.id))
    expect((await card(3538))?.points).toBe(5)
    expect(space).toMatchObject({ usesSprints: true, estimation: 'points' })
  })

  it('holds Jira’s active sprint as planned when the space already runs one of its own', async () => {
    const sprint = {
      id: 2,
      name: 'Sprint 32',
      state: 'active',
      startDate: '2026-10-20T12:00:00.000Z',
      endDate: '2026-11-03T12:00:00.000Z'
    }
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      issue: { ...story.issue, fields: { ...(story.issue.fields as object), customfield_10020: [sprint] } }
    })
    const spaceId = uuidGenerator.next()
    await db.insert(spaces).values({
      id: spaceId,
      organizationId,
      key: 'TEC',
      name: 'Delivery Board',
      type: 'software',
      createdAt: clock.now()
    })
    await db.insert(sprints).values({
      id: uuidGenerator.next(),
      organizationId,
      spaceId,
      number: 1,
      name: 'Do JiraIA',
      state: 'active',
      startsOn: '2026-10-27',
      endsOn: '2026-11-10',
      createdAt: clock.now()
    })

    await run('i1')
    const rows = await db.select().from(sprints).where(eq(sprints.spaceId, spaceId))

    expect(rows.map((row) => [row.name, row.state]).sort()).toEqual([
      ['Do JiraIA', 'active'],
      ['Sprint 32', 'planned']
    ])
  })

  it('changes only what Jira changed when run again', async () => {
    await run('i1')
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      issue: { ...story.issue, fields: { ...(story.issue.fields as object), summary: 'Nova tela v2' } }
    })

    const report = await run('i2')

    expect(report.spaces[0]?.cards).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 })
    expect(report.spaces[0]?.comments).toMatchObject({ inserted: 0, unchanged: 1 })
    expect((await card(3538))?.title).toBe('Nova tela v2')
    expect(await db.select().from(cards)).toHaveLength(2)
  })
})
