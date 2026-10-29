import { describe, expect, it } from 'bun:test'
import { gzipSync } from 'node:zlib'

import { databaseDoc, dateOf, emojiOf, kindOf, pageDoc, parseBackup, placeTree } from '../import/confluence-content.js'

/** Etapa 8e: where a Confluence node sits in Draw and what a database or a page opens as (ADR-0036). */
const fallback = new Date('2026-10-29T00:00:00.000Z')

describe('a Confluence node in Draw', () => {
  it('keeps Confluence’s order among siblings and gathers archived pages, with what hangs on them', () => {
    const rows = [
      { id: 'home', type: 'page' as const, parentId: null },
      { id: 'old', type: 'page' as const, parentId: null },
      { id: 'b', type: 'folder' as const, parentId: 'home' },
      { id: 'a', type: 'page' as const, parentId: 'home' },
      { id: 'under-old', type: 'page' as const, parentId: 'old' }
    ]
    const nodes = new Map([
      ['home', { position: 1 }],
      ['old', { position: 2, status: 'archived' }],
      ['b', { position: 20, title: 'B' }],
      ['a', { position: 10, title: 'A' }],
      ['under-old', { position: 1 }]
    ])
    const placed = placeTree(rows, nodes, 'archive')
    expect(placed.get('a')).toEqual({ parentId: 'home', position: 1 })
    expect(placed.get('b')).toEqual({ parentId: 'home', position: 2 })
    expect(placed.get('old')).toEqual({ parentId: 'archive', position: 1 })
    expect(placed.get('under-old')).toEqual({ parentId: 'old', position: 1 })
  })

  it('reads kinds, dates and the title emoji as Confluence writes them', () => {
    expect([kindOf('folder'), kindOf('whiteboard'), kindOf('database'), kindOf('embed')]).toEqual([
      'folder',
      'whiteboard',
      'page',
      'page'
    ])
    expect(dateOf(1721755673407, fallback).toISOString()).toBe('2024-07-23T17:27:53.407Z')
    expect(dateOf('nunca', fallback)).toBe(fallback)
    const emoji = (value: string) => ({ properties: { results: [{ key: 'emoji-title-published', value }] } })
    expect(emojiOf(emoji('1f9d0'))).toBe('🧐')
    expect(emojiOf(emoji(''))).toBeNull()
  })

  it('opens a database as a table of its fields and entries', () => {
    const doc = databaseDoc({
      fields: ['f1', 'f2'],
      fieldsById: { f1: { name: 'Nome' }, f2: { name: 'Exemplo' } },
      entries: ['e1'],
      entriesById: {
        e1: { values: { f1: { value: { plain: 'boas-vindas' } }, f2: { value: { plain: 'Olá\nmundo' } } } }
      }
    })
    const [header, row] = doc.content?.[0]?.content ?? []
    expect(header?.content?.map((cell) => cell.content?.[0]?.content?.[0]?.text)).toEqual(['Nome', 'Exemplo'])
    expect(row?.content?.[1]?.content?.[0]?.content).toEqual([
      { type: 'text', text: 'Olá' },
      { type: 'hardBreak' },
      { type: 'text', text: 'mundo' }
    ])
  })

  it('lists at the end of a page the attachments its body does not show', () => {
    const body = {
      type: 'doc',
      content: [{ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'shown' } }] }]
    }
    const file = (mediaId: string, image: boolean) => ({
      mediaId,
      fileId: `f-${mediaId}`,
      name: mediaId,
      size: 1,
      image
    })
    const doc = pageDoc(
      body,
      {
        mention: () => undefined,
        file: (id) => (id === 'shown' ? file('shown', true) : undefined),
        anchor: () => undefined
      },
      [file('shown', true), file('extra', false)]
    )
    expect(doc.content?.map((node) => node.type)).toEqual(['pageImage', 'horizontalRule', 'heading', 'pageFile'])
    expect(doc.content?.at(-1)?.attrs).toEqual({ fileId: 'f-extra', name: 'extra', size: 1 })
  })

  it('reads the backup’s export: a gzipped whiteboard after its version byte, a database as it is', () => {
    const board = Buffer.concat([Buffer.from([2]), gzipSync(JSON.stringify({ nodes: {}, edges: {} }))])
    const csv = [
      'contentId,documentId,spaceId,documentType,data',
      `10,d1,1,whiteboard,${board.toString('base64')}`,
      `11,d2,1,database,${Buffer.from(JSON.stringify({ fields: [] })).toString('base64')}`,
      '000000,1'
    ].join('\n')
    const found = parseBackup(csv)
    expect(found.get('10')).toEqual({ documentType: 'whiteboard', doc: { nodes: {}, edges: {} } })
    expect(found.get('11')).toEqual({ documentType: 'database', doc: { fields: [] } })
    expect(found.size).toBe(2)
  })
})
