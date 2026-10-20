import { describe, expect, it } from 'vitest'

import { fromBase64, toBase64 } from './base64'
import { ancestorsOf, buildTree, descendantsOf, dropTarget, filterTree } from './content-tree'
import { diffLines, diffSummary } from './diff'

const nodes = [
  { id: 'a', parentId: null, title: 'Esteira', position: 1 },
  { id: 'b', parentId: 'a', title: 'Discovery', position: 1 },
  { id: 'c', parentId: 'a', title: 'Delivery', position: 2 },
  { id: 'd', parentId: 'b', title: 'Especificação', position: 1 },
  { id: 'e', parentId: null, title: 'Atas', position: 2 }
]

describe('the page tree', () => {
  it('nests pages under their parents, siblings in order', () => {
    const tree = buildTree(nodes)
    expect(tree.map((each) => each.title)).toEqual(['Esteira', 'Atas'])
    expect(tree[0]?.children.map((each) => each.title)).toEqual(['Discovery', 'Delivery'])
  })

  it('knows a page’s descendants and ancestors', () => {
    expect([...descendantsOf(nodes, 'a')].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(ancestorsOf(nodes, 'd').map((each) => each.title)).toEqual(['Esteira', 'Discovery'])
  })

  it('places a dropped page inside, before or after another, never under itself', () => {
    expect(dropTarget(nodes, 'e', 'a', 'inside')).toEqual({ parentId: 'a', index: 2 })
    expect(dropTarget(nodes, 'c', 'b', 'before')).toEqual({ parentId: 'a', index: 0 })
    expect(dropTarget(nodes, 'e', 'b', 'after')).toEqual({ parentId: 'a', index: 1 })
    expect(dropTarget(nodes, 'a', 'd', 'inside')).toBeUndefined()
    expect(
      dropTarget(
        [...nodes, { id: 'w', parentId: null, title: 'Quadro', position: 3, kind: 'whiteboard' }],
        'e',
        'w',
        'inside'
      )
    ).toBeUndefined()
  })

  it('filters by title, accents ignored, keeping the folders above each match', () => {
    expect(filterTree(nodes, 'especificacao', new Set()).map((each) => each.id)).toEqual(['a', 'b', 'd'])
    expect(filterTree(nodes, '', new Set())).toHaveLength(5)
  })
})

describe('comparing versions', () => {
  it('marks lines kept, taken out and put in', () => {
    const lines = diffLines('Contexto\nProblema\nEscopo', 'Contexto\nEscopo\nCritérios')
    expect(lines).toEqual([
      { kind: 'same', text: 'Contexto' },
      { kind: 'removed', text: 'Problema' },
      { kind: 'same', text: 'Escopo' },
      { kind: 'added', text: 'Critérios' }
    ])
    expect(diffSummary(lines)).toEqual({ added: 1, removed: 1 })
  })
})

describe('base64', () => {
  it('round-trips bytes, including large ones', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})
