import { describe, expect, it } from 'bun:test'
import { createLogger } from '@jiraia/logger'

import { fakeIssue, InMemoryAtlassian } from '../import/atlassian-source.js'
import { InMemoryImportStore } from '../import/import-store.js'
import { JiraWatcherCopy, watchersKey } from '../import/jira-watcher-copy.js'

/** Etapa 8c: who watches each issue, asked of Jira only for issues that have watchers. */
const ANA = { accountId: '712020:00000000-0000-4000-8000-00000000000a', displayName: 'Ana Souza' }

const issue = (id: string, watchCount: number) =>
  fakeIssue({ id, key: `TEC-${id}`, project: 'TEC', updated: '', issue: { fields: { watches: { watchCount } } } })

describe('Jira watcher copy', () => {
  it('keeps the watchers of each issue that has any, and does not ask for the others', async () => {
    const store = new InMemoryImportStore()
    const source = new InMemoryAtlassian({ projects: [], issues: [], watchers: { '1': [ANA] } })
    await store.putJson('import/r1/jira/issues/1.json', issue('1', 1))
    await store.putJson('import/r1/jira/issues/2.json', issue('2', 0))
    const tally = { comments: 0, changes: 0, worklogs: 0, attachments: 0, attachmentBytes: 0, links: 0 }
    await store.putJson('import/r1/jira/manifest.json', {
      run: 'r1',
      issues: {
        '1': { key: 'TEC-1', updated: '', path: 'import/r1/jira/issues/1.json', tally },
        '2': { key: 'TEC-2', updated: '', path: 'import/r1/jira/issues/2.json', tally }
      }
    })

    const report = await new JiraWatcherCopy({ source, store, logger: createLogger('work', 'import') }).run('r1')

    expect(report).toEqual({ run: 'r1', issues: 2, asked: 1, watchers: 1 })
    expect(store.documents.get(watchersKey('r1', '1'))).toEqual([ANA])
    expect(source.fetched).toEqual(['watchers:1'])
  })
})
