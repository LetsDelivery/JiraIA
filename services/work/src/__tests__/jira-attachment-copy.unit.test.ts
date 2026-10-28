import { describe, expect, it } from 'bun:test'
import { fixedClock, NotFoundException } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'

import { fakeIssue, InMemoryAtlassian } from '../import/atlassian-source.js'
import { InMemoryImportStore } from '../import/import-store.js'
import { attachmentKey, JiraAttachmentCopy } from '../import/jira-attachment-copy.js'
import { JiraRawCopy } from '../import/jira-raw-copy.js'

/** Etapa 8a: every attachment's bytes beside the raw copy, each downloaded once (ADR-0036). */
const logger = createLogger('work', 'import')
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

const withFiles = fakeIssue({
  id: '13696',
  key: 'TEC-216',
  project: 'TEC',
  updated: '2026-02-23T10:24:23.384-0300',
  issue: {
    fields: {
      project: { key: 'TEC' },
      updated: '2026-02-23T10:24:23.384-0300',
      attachment: [
        { id: '12503', filename: 'tela.png', size: 4, mimeType: 'image/png' },
        { id: '12504', filename: 'contrato.pdf', size: 9, mimeType: 'application/pdf' }
      ]
    }
  }
})

const setup = async () => {
  const source = new InMemoryAtlassian({
    projects: [{ id: '10132', key: 'TEC', name: 'Delivery Board' }],
    issues: [
      withFiles,
      fakeIssue({ id: '17871', key: 'TEC-8', project: 'TEC', updated: '2025-10-21T09:28:26.281-0300' })
    ],
    files: new Map([
      ['12503', png],
      ['12504', pdf]
    ])
  })
  const store = new InMemoryImportStore()
  const clock = fixedClock(new Date('2026-10-28T19:00:00.000Z'))
  await new JiraRawCopy({ source, store, clock, logger }).run({ run: 'r1', projects: ['TEC'] })
  source.fetched.length = 0
  return { source, store, copy: new JiraAttachmentCopy({ source, store, logger }) }
}

describe('Jira attachment copy', () => {
  it('stores each attachment once, by its id, outside the run', async () => {
    const { store, copy } = await setup()
    const report = await copy.run('r1')

    expect(store.documents.get(attachmentKey('12503'))).toEqual(png)
    expect(report).toMatchObject({ attachments: 2, copied: 2, alreadyStored: 0, bytes: 9 })
    expect(store.documents.get('import/r1/jira/attachments-report.json')).toEqual(report)
  })

  it('does not download again what a previous run stored', async () => {
    const { source, copy } = await setup()
    await copy.run('r1')
    source.fetched.length = 0

    const report = await copy.run('r1')

    expect(source.fetched).toEqual([])
    expect(report).toMatchObject({ copied: 0, alreadyStored: 2 })
  })

  it('lists an attachment whose bytes do not match the size Jira declared', async () => {
    const { copy } = await setup()
    const report = await copy.run('r1')

    expect(report.sizeMismatch).toEqual(['12504'])
  })

  it('refuses a run that has no manifest', async () => {
    const { copy } = await setup()

    await expect(copy.run('nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})
