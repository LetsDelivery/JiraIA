import { describe, expect, it } from 'bun:test'

import { adfToProseMirror, type ProseMirrorOptions, textOf } from '../import/adf-prosemirror.js'

/** Etapa 8e: a Confluence page's body as the document LET'S Draw's editor opens (ADR-0036). */
const options: ProseMirrorOptions = {
  mention: (accountId) => (accountId === 'ana' ? { id: 'm-ana', label: 'Ana Souza' } : undefined),
  file: (mediaId) => (mediaId === 'img-1' ? { fileId: 'f-1', name: 'tela.png', size: 120, image: true } : undefined),
  anchor: (id) => (id === 'open' ? 'open' : undefined)
}
const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })

describe('a Confluence body in Draw', () => {
  it('keeps marks under Draw’s names, code alone with its link and comment', () => {
    const out = adfToProseMirror(
      doc(
        para(
          text('forte', [{ type: 'strong' }, { type: 'textColor', attrs: { color: '#ff0000' } }]),
          text('x()', [{ type: 'code' }, { type: 'strong' }, { type: 'annotation', attrs: { id: 'open' } }])
        )
      ),
      options
    )
    expect(out.content?.[0]?.content).toEqual([
      { type: 'text', text: 'forte', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff0000' } }] },
      { type: 'text', text: 'x()', marks: [{ type: 'code' }, { type: 'comment', attrs: { id: 'open' } }] }
    ])
  })

  it('marks only an inline comment still open, and names a person Draw knows', () => {
    const out = adfToProseMirror(
      doc(
        para(
          text('resolvido', [{ type: 'annotation', attrs: { id: 'closed' } }]),
          { type: 'mention', attrs: { id: 'ana', text: '@Ana' } },
          { type: 'mention', attrs: { id: 'saiu', text: '@Quem Saiu' } }
        )
      ),
      options
    )
    expect(out.content?.[0]?.content).toEqual([
      { type: 'text', text: 'resolvido' },
      { type: 'mention', attrs: { id: 'm-ana', label: 'Ana Souza' } },
      { type: 'text', text: '@Quem Saiu' }
    ])
  })

  it('shows an imported image as the page’s image, and an unknown file by its name', () => {
    const out = adfToProseMirror(
      doc(
        { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'img-1', type: 'file' } }] },
        { type: 'mediaGroup', content: [{ type: 'media', attrs: { id: 'gone', alt: 'contrato.pdf' } }] }
      ),
      options
    )
    expect(out.content).toEqual([
      { type: 'pageImage', attrs: { fileId: 'f-1', name: 'tela.png', size: 120 } },
      { type: 'paragraph', content: [{ type: 'text', text: '📎 contrato.pdf' }] }
    ])
  })

  it('opens what Draw has no node for as words: a panel, a status, a layout, a macro', () => {
    const out = adfToProseMirror(
      doc(
        { type: 'panel', content: [para(text('atenção'))] },
        para({ type: 'status', attrs: { text: 'feito' } }),
        { type: 'layoutSection', content: [{ type: 'layoutColumn', content: [para(text('coluna'))] }] },
        { type: 'extension', attrs: { extensionKey: 'toc' } }
      ),
      options
    )
    expect(out.content?.map((node) => node.type)).toEqual(['callout', 'paragraph', 'paragraph', 'paragraph'])
    expect(textOf(out)).toBe('atenção\nFEITO\ncoluna\n[Macro do Confluence: toc]')
  })

  it('starts every list item with a paragraph and never leaves a cell or a page empty', () => {
    const out = adfToProseMirror(
      doc(
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [] }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [] }] }] }
      ),
      options
    )
    expect(out.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe('paragraph')
    expect(out.content?.[1]?.content?.[0]?.content?.[0]?.content).toEqual([{ type: 'paragraph' }])
    expect(adfToProseMirror(null, options)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})
