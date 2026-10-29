import { beforeEach, describe, expect, it } from 'bun:test'
import { fixedClock, uuidGenerator } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'
import { answer, apiEvent, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { and, eq, isNull } from 'drizzle-orm'
import { buildService } from '../container.js'
import { fakeIssue } from '../import/atlassian-source.js'
import { InMemoryAttachmentFiles } from '../import/attachment-files.js'
import { ImportRepository } from '../import/import.repository.js'
import { InMemoryImportStore } from '../import/import-store.js'
import { JiraImport } from '../import/jira-import.js'
import type { Person } from '../import/people.js'
import { PEOPLE_MAPPING } from '../import/people-scan.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import {
  auditEvents,
  boardColumns,
  cardAttachments,
  cardComments,
  cardKeyAliases,
  cardLinks,
  cards,
  cardTypes,
  cardWatchers,
  customFields,
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
let files: InMemoryAttachmentFiles
let actorId: string
let organizationId: string

const importer = () =>
  new JiraImport({ db, store, files, clock, ids: uuidGenerator, logger: createLogger('work', 'import') })
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
  files = new InMemoryAttachmentFiles()
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

  it('shows the columns of the Jira board, and leaves the other states off the board', async () => {
    await store.putJson('import/raw1/jira/boards.json', [
      {
        project: 'TEC',
        board: { id: 31, name: 'quadro TDV3' },
        columns: [{ name: 'BLOQUEIO', statuses: ['IMPEDIMENTO'] }]
      }
    ])
    await run('i1')
    const columns = await db.select().from(boardColumns)
    const states = await db.select().from(workflowStates)

    expect(columns.map((column) => column.name)).toEqual(['BLOQUEIO'])
    expect(states.find((state) => state.name === 'IMPEDIMENTO')?.columnId).toBe(String(columns[0]?.id))
    expect(states.find((state) => state.name === 'DOWNSTREAM')?.columnId).toBeNull()
  })

  it('removes a column the Jira board does not have', async () => {
    await run('i1')
    await store.putJson('import/raw1/jira/boards.json', [
      {
        project: 'TEC',
        board: { id: 31, name: 'quadro TDV3' },
        columns: [{ name: 'BLOQUEIO', statuses: ['IMPEDIMENTO'] }]
      }
    ])
    await run('i2')

    expect((await db.select().from(boardColumns)).map((column) => column.name)).toEqual(['BLOQUEIO'])
  })

  it('gives a project without a Jira board one column per status, from not started to done', async () => {
    await run('i1')
    const columns = await db.select().from(boardColumns)

    expect(columns.sort((a, b) => a.position - b.position).map((column) => column.name)).toEqual([
      'IMPEDIMENTO',
      'DOWNSTREAM'
    ])
  })

  it('makes an existing space’s workflow Jira’s: every declared status, the sub-task level, and nothing JiraIA added', async () => {
    const spaceId = uuidGenerator.next()
    await db.insert(spaces).values({
      id: spaceId,
      organizationId,
      key: 'TEC',
      name: 'Delivery Board',
      type: 'software',
      createdAt: clock.now()
    })
    const unused = uuidGenerator.next()
    const named = uuidGenerator.next()
    await db.insert(workflowStates).values([
      { id: unused, spaceId, name: 'A fazer', group: 'not_started', position: 0, createdAt: clock.now() },
      { id: named, spaceId, name: 'Em teste', group: 'in_progress', position: 1, createdAt: clock.now() }
    ])
    const typeId = uuidGenerator.next()
    await db.insert(cardTypes).values({ id: typeId, spaceId, name: 'Tarefa', position: 0, createdAt: clock.now() })
    await db.insert(cards).values({
      id: uuidGenerator.next(),
      organizationId,
      spaceId,
      number: 1,
      typeId,
      stateId: named,
      title: 'Feito no JiraIA',
      reporterId: actorId,
      priority: 'medium',
      rank: 1,
      createdAt: clock.now(),
      updatedAt: clock.now()
    })
    await store.putJson('import/raw1/jira/projects.json', [
      {
        id: '10132',
        key: 'TEC',
        name: 'Delivery Board',
        projectTypeKey: 'software',
        issueTypes: [{ name: 'História' }, { name: 'Subtarefa', subtask: true }]
      }
    ])
    await store.putJson('import/raw1/jira/statuses/TEC.json', [
      {
        name: 'Story',
        statuses: [
          { name: 'IMPEDIMENTO', statusCategory: { key: 'new' } },
          { name: 'IMERSÃO', statusCategory: { key: 'indeterminate' } }
        ]
      }
    ])

    const report = await run('i1')
    const states = (await db.select().from(workflowStates).where(eq(workflowStates.spaceId, spaceId))).map(
      (state) => state.name
    )
    const subtask = (await db.select().from(cardTypes).where(eq(cardTypes.name, 'Subtarefa')))[0]

    expect(states.sort()).toEqual(['DOWNSTREAM', 'Em teste', 'IMERSÃO', 'IMPEDIMENTO'])
    expect(subtask?.isSubtask).toBe(true)
    expect(report.spaces[0]?.workflow).toEqual({ removed: ['state A fazer'], kept: ['state Em teste', 'type Tarefa'] })
  })

  it('copies each attachment into the card with Jira’s name, author and date, once', async () => {
    const withFile = {
      ...story,
      issue: {
        ...story.issue,
        fields: {
          ...(story.issue.fields as object),
          attachment: [
            {
              id: '12503',
              filename: 'tela.png',
              size: 4,
              mimeType: 'image/png',
              created: '2026-10-27T19:10:00.000-0300',
              author: user(ANA, 'Ana Souza')
            }
          ]
        }
      }
    }
    await store.putJson('import/raw1/jira/issues/101.json', withFile)
    const report = await run('i1')
    await run('i2')
    const rows = await db.select().from(cardAttachments)
    const ana = (await db.select().from(members).where(eq(members.email, 'ana@uselets.com')))[0]
    const storyRow = await card(3538)

    expect(report.spaces[0]?.attachments).toMatchObject({ inserted: 1, bytes: 4, missing: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'tela.png',
      contentType: 'image/png',
      size: 4,
      status: 'ready',
      uploadedBy: ana?.id
    })
    expect(rows[0]?.createdAt.toISOString()).toBe('2026-10-27T22:10:00.000Z')
    expect(files.copies).toEqual([
      { from: 'import/jira/attachments/12503', to: `${organizationId}/${storyRow?.id}/${rows[0]?.id}` }
    ])
  })

  it('lists an attachment the raw copy lacks instead of stopping, and brings it once it is there', async () => {
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      issue: {
        ...story.issue,
        fields: {
          ...(story.issue.fields as object),
          attachment: [
            {
              id: '22265',
              filename: 'novo.pdf',
              size: 9,
              mimeType: 'application/pdf',
              created: '2026-10-28T10:00:00.000-0300',
              author: user(ANA, 'Ana Souza')
            }
          ]
        }
      }
    })
    files.absent.add('import/jira/attachments/22265')

    const first = await run('i1')
    files.absent.clear()
    const second = await run('i2')

    expect(first.spaces[0]?.attachments).toMatchObject({ inserted: 0, missing: ['22265'] })
    expect(second.spaces[0]?.attachments).toMatchObject({ inserted: 1, missing: [] })
  })

  it('links two imported cards once, in JiraIA’s direction, with the date and author of the changelog', async () => {
    const link = (
      id: string,
      name: string,
      side: 'outwardIssue' | 'inwardIssue',
      other: { id: string; key: string }
    ) => ({ id, type: { name }, [side]: other })
    const withLinks = (record: typeof story, links: object[], changelog: object[] = []) => ({
      ...record,
      changelog: [...record.changelog, ...changelog],
      issue: { ...record.issue, fields: { ...(record.issue.fields as object), issuelinks: links } }
    })
    await store.putJson(
      'import/raw1/jira/issues/101.json',
      withLinks(
        story,
        [
          link('9001', 'Blocks', 'outwardIssue', { id: '100', key: 'TEC-216' }),
          link('9002', 'Polaris work item link', 'outwardIssue', { id: '100', key: 'TEC-216' }),
          link('9003', 'Relates', 'outwardIssue', { id: '777', key: 'PRD-9' })
        ],
        [
          {
            id: '2',
            created: '2026-10-27T19:30:00.000-0300',
            author: user(ANA, 'Ana Souza'),
            items: [{ field: 'Link', to: 'TEC-216', toString: 'This work item blocks TEC-216' }]
          }
        ]
      )
    )
    await store.putJson(
      'import/raw1/jira/issues/100.json',
      withLinks(epic, [link('9001', 'Blocks', 'inwardIssue', { id: '101', key: 'TEC-3538' })])
    )

    const report = await run('i1')
    const rows = await db.select().from(cardLinks)
    const [storyRow, epicRow] = [await card(3538), await card(216)]
    const blocks = rows.find((row) => row.type === 'blocks')

    expect(report.links).toEqual({ inserted: 2, unchanged: 0, waiting: 1 })
    expect(blocks).toMatchObject({ fromCardId: storyRow?.id, toCardId: epicRow?.id })
    expect(blocks?.createdAt.toISOString()).toBe('2026-10-27T22:30:00.000Z')
    expect(rows.find((row) => row.type === 'delivers')).toMatchObject({
      fromCardId: epicRow?.id,
      toCardId: storyRow?.id
    })
    expect((await run('i2')).links).toEqual({ inserted: 0, unchanged: 2, waiting: 1 })
  })

  it('makes Jira’s watchers watch the card, leaving apps out, and keeps logged time read-only', async () => {
    const bot = {
      accountId: '557058:00000000-0000-4000-8000-0000000000ff',
      displayName: 'Automation for Jira',
      accountType: 'app'
    }
    await store.putJson('import/raw1/jira/watchers/101.json', [user(ANA, 'Ana Souza'), bot])
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      worklogs: [
        {
          id: 'w1',
          author: user(ANA, 'Ana Souza'),
          started: '2026-10-27T09:00:00.000-0300',
          timeSpentSeconds: 5400,
          comment: doc('Pareamento'),
          created: '2026-10-27T10:30:00.000-0300'
        }
      ]
    })

    const report = await run('i1')
    await run('i2')
    const storyRow = await card(3538)
    const ana = (await db.select().from(members).where(eq(members.email, 'ana@uselets.com')))[0]
    const watching = await db
      .select()
      .from(cardWatchers)
      .where(eq(cardWatchers.cardId, String(storyRow?.id)))
    const service = buildService(
      {
        DATABASE_URL: 'unused',
        AWS_REGION: 'us-east-1',
        ALLOWED_EMAIL_DOMAINS: ['uselets.com'],
        ATTACHMENTS_BUCKET: 'unused',
        REALTIME_URL: 'ws://localhost/realtime'
      },
      { db }
    )
    const listed = answer(
      await service.router(
        apiEvent({ method: 'GET', path: `/cards/${storyRow?.id}/worklogs`, claims: googleClaims('stenio@uselets.com') })
      )
    )

    expect(report.spaces[0]?.watchers).toEqual({ watchers: 1, worklogs: 1 })
    expect(watching.map((row) => row.memberId)).toEqual([String(ana?.id)])
    expect(listed.body).toEqual({
      items: [
        {
          id: expect.any(String),
          author: { id: ana?.id, name: 'Ana Souza' },
          startedAt: '2026-10-27T12:00:00.000Z',
          seconds: 5400,
          comment: 'Pareamento'
        }
      ]
    })
  })

  it('writes the card’s past with Jira’s dates and authors, dispatched, so reports see it and nobody hears of it', async () => {
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      changelog: [
        ...story.changelog,
        {
          id: '7',
          created: '2026-10-27T18:00:00.000-0300',
          author: user(ANA, 'Ana Souza'),
          items: [{ field: 'status', fromString: 'IMPEDIMENTO', toString: 'DOWNSTREAM' }, { field: 'Rank' }]
        }
      ]
    })
    const pending = async () => (await db.select().from(auditEvents).where(isNull(auditEvents.dispatchedAt))).length
    const before = await pending()
    const report = await run('i1')
    await run('i2')
    const storyRow = await card(3538)
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, String(storyRow?.id)))
    const moved = events.find((event) => event.action === 'moved')
    const states = await db.select().from(workflowStates)
    const ana = (await db.select().from(members).where(eq(members.email, 'ana@uselets.com')))[0]

    expect(events.map((event) => event.action).sort()).toEqual(['commented', 'created', 'moved', 'transferred'])
    expect(moved).toMatchObject({ actorId: ana?.id, via: 'Jira' })
    expect(moved?.occurredAt.toISOString()).toBe('2026-10-27T21:00:00.000Z')
    expect(moved?.changes).toEqual({
      stateId: {
        before: states.find((s) => s.name === 'IMPEDIMENTO')?.id,
        after: states.find((s) => s.name === 'DOWNSTREAM')?.id
      }
    })
    expect(report.spaces[0]?.history).toMatchObject({ entries: 5, events: 5 })
    expect(await pending()).toBe(before)
    expect(events).toHaveLength(4)
  })

  it('reads every reference of a kind in pages, past one page of them', async () => {
    const repository = new ImportRepository(db)
    const rows = Array.from({ length: 4_050 }, (_, index) => ({
      organizationId,
      source: 'jira',
      entity: 'history',
      sourceId: `e${String(index).padStart(5, '0')}`,
      targetId: uuidGenerator.next(),
      contentHash: '',
      runId: 'r',
      importedAt: clock.now()
    }))
    for (let start = 0; start < rows.length; start += 1_000) {
      await repository.putRefs(db, rows.slice(start, start + 1_000))
    }

    expect((await repository.refs(organizationId, 'jira', 'history')).size).toBe(4_050)
  })

  it('tells apart two Jira fields of the same name by their Jira number', async () => {
    await store.putJson('import/raw1/jira/fields.json', [
      ...fields,
      {
        id: 'customfield_10100',
        name: 'Link',
        custom: true,
        schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:url' }
      },
      {
        id: 'customfield_10200',
        name: 'Link',
        custom: true,
        schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:url' }
      }
    ])
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      issue: {
        ...story.issue,
        fields: {
          ...(story.issue.fields as object),
          customfield_10100: 'https://a.test',
          customfield_10200: 'https://b.test'
        }
      }
    })

    await run('i1')
    await run('i2')

    expect((await db.select().from(customFields)).map((field) => field.name).sort()).toEqual(['Link', 'Link (10200)'])
  })

  it('changes only what Jira changed when run again, keeping what only JiraIA holds', async () => {
    await run('i1')
    await db.update(cards).set({ estimate: 'M' }).where(eq(cards.number, 3538))
    await store.putJson('import/raw1/jira/issues/101.json', {
      ...story,
      issue: { ...story.issue, fields: { ...(story.issue.fields as object), summary: 'Nova tela v2' } }
    })

    const report = await run('i2')

    expect(report.spaces[0]?.cards).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 })
    expect(report.spaces[0]?.comments).toMatchObject({ inserted: 0, unchanged: 1 })
    expect((await card(3538))?.title).toBe('Nova tela v2')
    expect((await card(3538))?.estimate).toBe('M')
    expect(await db.select().from(cards)).toHaveLength(2)
  })
})
