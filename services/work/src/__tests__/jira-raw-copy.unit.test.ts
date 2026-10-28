import { describe, expect, it } from 'bun:test'
import { fixedClock } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'

import { fakeIssue, InMemoryAtlassian } from '../import/atlassian-source.js'
import { InMemoryImportStore } from '../import/import-store.js'
import { JiraRawCopy, type Manifest } from '../import/jira-raw-copy.js'

/**
 * Etapa 8a: Jira is copied as it is, counted per project, and a later run asks Jira only for what
 * changed (ADR-0036).
 */
const projects = [
  { id: '10132', key: 'TEC', name: 'Delivery Board' },
  { id: '10495', key: 'REQ', name: 'Requisições' }
]

const tec216 = fakeIssue({
  id: '13696',
  key: 'TEC-216',
  project: 'TEC',
  updated: '2026-02-23T10:24:23.384-0300',
  issue: {
    fields: {
      project: { key: 'TEC' },
      updated: '2026-02-23T10:24:23.384-0300',
      attachment: [{ size: 1200 }, { size: 300 }],
      issuelinks: [{ id: '1' }]
    }
  },
  changelog: [{ id: '42781' }, { id: '69166', items: [{ field: 'Key', fromString: 'LD-17', toString: 'TEC-216' }] }],
  comments: [{ id: 'c1' }],
  worklogs: [{ id: 'w1' }, { id: 'w2' }]
})
const tec8 = fakeIssue({ id: '17871', key: 'TEC-8', project: 'TEC', updated: '2025-10-21T09:28:26.281-0300' })
const req39 = fakeIssue({ id: '40579', key: 'REQ-39', project: 'REQ', updated: '2026-10-19T12:02:17.387-0300' })

const setup = () => {
  const source = new InMemoryAtlassian({
    projects,
    issues: [tec216, tec8, req39],
    fields: [{ id: 'customfield_10650' }]
  })
  const store = new InMemoryImportStore()
  const copy = new JiraRawCopy({
    source,
    store,
    clock: fixedClock(new Date('2026-10-28T19:00:00.000Z')),
    logger: createLogger('work', 'import'),
    concurrency: 2
  })
  return { source, store, copy }
}

describe('Jira raw copy', () => {
  it('keeps every issue as Jira answered it, with its changelog, comments and worklogs', async () => {
    const { store, copy } = setup()
    await copy.run({ run: 'r1', projects: ['TEC', 'REQ'] })

    expect(store.documents.get('import/r1/jira/issues/13696.json')).toEqual(tec216)
    expect(store.documents.get('import/r1/jira/projects.json')).toEqual(projects)
    expect(store.documents.get('import/r1/jira/fields.json')).toEqual([{ id: 'customfield_10650' }])
  })

  it('counts both sides per project for the reconciliation report', async () => {
    const { store, copy } = setup()
    const report = await copy.run({ run: 'r1', projects: ['TEC', 'REQ'] })

    expect(report.projects.find((project) => project.key === 'TEC')).toEqual({
      key: 'TEC',
      expected: 2,
      copied: 2,
      reused: 0,
      difference: 0,
      comments: 1,
      changes: 2,
      worklogs: 2,
      attachments: 2,
      attachmentBytes: 1500,
      links: 1
    })
    expect(store.documents.get('import/r1/jira/report.json')).toEqual(report)
  })

  it('names a project the account cannot see instead of skipping it quietly', async () => {
    const { copy } = setup()
    const report = await copy.run({ run: 'r1', projects: ['TEC', 'JUR'] })

    expect(report.notVisible).toEqual(['JUR'])
    expect(report.projects.map((project) => project.key)).toEqual(['TEC'])
  })

  it('asks Jira again only for the issues updated since the previous run', async () => {
    const { source, store, copy } = setup()
    await copy.run({ run: 'r1', projects: ['TEC'] })
    source.data.issues[1] = fakeIssue({
      id: '17871',
      key: 'TEC-8',
      project: 'TEC',
      updated: '2026-10-28T10:00:00.000-0300'
    })
    source.fetched.length = 0

    const report = await copy.run({ run: 'r2', projects: ['TEC'], previousRun: 'r1' })

    expect(source.fetched).toEqual(['17871'])
    expect(report.projects[0]).toMatchObject({ copied: 1, reused: 1, difference: 0, comments: 1 })
    const manifest = store.documents.get('import/r2/jira/manifest.json') as Manifest
    expect(manifest.issues['13696']?.path).toBe('import/r1/jira/issues/13696.json')
    expect(manifest.issues['17871']?.path).toBe('import/r2/jira/issues/17871.json')
  })
})
