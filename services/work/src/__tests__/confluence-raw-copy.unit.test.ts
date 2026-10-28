import { describe, expect, it } from 'bun:test'
import { fixedClock } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'

import { ConfluenceRawCopy, type TreeRow, versionKey } from '../import/confluence-raw-copy.js'
import { InMemoryConfluence } from '../import/confluence-source.js'
import { InMemoryImportStore } from '../import/import-store.js'

/**
 * Etapa 8a: Confluence is copied as it is, walked as a tree from each space's root pages, and counted
 * per space (ADR-0036).
 */
const setup = () => {
  const source = new InMemoryConfluence({
    spaces: [
      { id: '1646133252', key: 'CS', name: 'CS' },
      { id: '1659404292', key: 'Produto', name: 'Produto' }
    ],
    nodes: [
      { id: 'home', type: 'page', space: '1646133252', body: { title: 'CS' } },
      { id: 'manuais', type: 'folder', space: '1646133252', parent: 'home' },
      { id: 'tickets', type: 'embed', space: '1646133252', parent: 'manuais' },
      { id: 'regua', type: 'whiteboard', space: '1646133252', parent: 'home' },
      {
        id: 'guia',
        type: 'page',
        space: '1646133252',
        parent: 'manuais',
        extras: {
          versions: [{ number: 1 }, { number: 2 }],
          footerComments: [{ id: 'f1', replies: [{ id: 'f2', replies: [] }] }],
          inlineComments: [{ id: 'i1', replies: [] }],
          attachments: [{ id: 'a1', fileSize: 2048 }]
        }
      },
      { id: 'prd-home', type: 'page', space: '1659404292' }
    ]
  })
  const store = new InMemoryImportStore()
  const clock = fixedClock(new Date('2026-10-28T19:00:00.000Z'))
  const copy = new ConfluenceRawCopy({ source, store, clock, logger: createLogger('work', 'import'), concurrency: 2 })
  return { store, copy }
}

describe('Confluence raw copy', () => {
  it('finds folders, whiteboards and embeds by walking the tree, and keeps where each one sits', async () => {
    const { store, copy } = setup()
    await copy.run({ run: 'r1', spaces: ['CS'] })

    const tree = store.documents.get('import/r1/confluence/CS/tree.json') as TreeRow[]
    expect(tree.map((row) => [row.id, row.type, row.parentId])).toEqual([
      ['home', 'page', null],
      ['manuais', 'folder', 'home'],
      ['regua', 'whiteboard', 'home'],
      ['tickets', 'embed', 'manuais'],
      ['guia', 'page', 'manuais']
    ])
    expect(store.documents.get('import/r1/confluence/CS/whiteboards/regua.json')).toEqual({
      node: { id: 'regua', type: 'whiteboard' }
    })
  })

  it('keeps a page with every version, its comments with their replies, and its attachments', async () => {
    const { store, copy } = setup()
    await copy.run({ run: 'r1', spaces: ['CS'] })

    expect(store.documents.get('import/r1/confluence/CS/pages/guia.json')).toMatchObject({
      versions: [{ number: 1 }, { number: 2 }],
      footerComments: [{ id: 'f1', replies: [{ id: 'f2' }] }],
      attachments: [{ id: 'a1' }]
    })
  })

  it('keeps every version’s body once, outside the run, so a later run fetches only new versions', async () => {
    const { store, copy } = setup()
    await copy.run({ run: 'r1', spaces: ['CS'] })

    expect(store.documents.get(versionKey('guia', 1))).toMatchObject({ body: { atlas_doc_format: { value: 'v1' } } })
    const again = await copy.run({ run: 'r2', spaces: ['CS'] })
    expect(again.spaces[0]?.versionBodies).toBe(0)
  })

  it('counts each space for the reconciliation report, and names a space the account cannot see', async () => {
    const { store, copy } = setup()
    const report = await copy.run({ run: 'r1', spaces: ['CS', 'Produto', 'BA'] })

    expect(report.spaces[0]).toEqual({
      key: 'CS',
      page: 2,
      folder: 1,
      whiteboard: 1,
      database: 0,
      embed: 1,
      versions: 2,
      versionBodies: 2,
      footerComments: 2,
      inlineComments: 1,
      attachments: 1,
      attachmentBytes: 2048
    })
    expect(report.notVisible).toEqual(['BA'])
    expect(store.documents.get('import/r1/confluence/report.json')).toEqual(report)
  })
})
