import { describe, expect, it } from 'bun:test'

import { type BoardNode, boardText, whiteboardToDraw } from '../import/confluence-whiteboard.js'

/** Etapa 8e: a Confluence whiteboard from the site backup, as editable Draw elements (ADR-0036). */
const words = (value: string) =>
  JSON.stringify({
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }]
  })
const at = (x: number, y: number, width: number, height: number) => ({
  geometry: { position: { x, y }, size: { x: width, y: height } }
})
const board = (nodes: BoardNode[], edges: BoardNode[] = []) => ({
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  edges: Object.fromEntries(edges.map((edge) => [edge.id, edge]))
})
const byId = (elements: ReturnType<typeof whiteboardToDraw>['elements']) =>
  new Map(elements.map((element) => [element.id, element]))

describe('a Confluence whiteboard in Draw', () => {
  it('places a shape by its corner, filled and stroked in its hue, with its words inside', () => {
    const out = whiteboardToDraw(
      board([
        {
          id: 's1',
          type: 'shape',
          shape: 'diamond',
          ...at(100, 50, 40, 20),
          color: 'palette.light.blue.200',
          strokeColor: 'palette.dark.blue.300',
          text: words('Decide'),
          zIndex: 3
        }
      ]),
      () => undefined
    )
    const shape = byId(out.elements).get('s1')
    expect(shape).toMatchObject({ type: 'diamond', x: 80, y: 40, width: 40, height: 20, z: 3 })
    expect(shape).toMatchObject({ backgroundColor: '#a5d8ff', strokeColor: '#1971c2' })
    expect(shape?.boundElements).toEqual([{ id: 's1-text', type: 'text' }])
    expect(byId(out.elements).get('s1-text')).toMatchObject({ type: 'text', text: 'Decide', containerId: 's1' })
  })

  it('ties a connector to both nodes at the same points of their boxes, with its label', () => {
    const out = whiteboardToDraw(
      board(
        [
          { id: 'a', type: 'sticky', ...at(0, 0, 100, 100), color: 'palette.light.yellow.200', text: words('A') },
          { id: 'b', type: 'sticky', ...at(300, 0, 100, 100), color: 'palette.light.yellow.200', text: words('B') },
          {
            id: 'c',
            type: 'connector',
            start: { x: 50, y: 0 },
            end: { x: 250, y: 0 },
            sourceAnchor: { left: 1, top: 0.5 },
            targetAnchor: { left: 0, top: 0.5 },
            presentation: 'dynamic',
            startCap: 'none',
            endCap: 'arrow'
          },
          { id: 'c-path-label', type: 'pathLabel', text: words('sim') }
        ],
        [
          { id: 'c', type: 'association', sourceNode: 'a', targetNode: 'b' },
          { id: 'c-path-label', type: 'attachment', source: 'c' }
        ]
      ),
      () => undefined
    )
    const elements = byId(out.elements)
    expect(elements.get('c')).toMatchObject({
      type: 'arrow',
      x: 50,
      points: [
        [0, 0],
        [200, 0]
      ],
      arrowType: 'elbow',
      startArrowhead: null,
      endArrowhead: 'arrow',
      startBinding: { elementId: 'a', anchor: [1, 0.5] },
      endBinding: { elementId: 'b', anchor: [0, 0.5] }
    })
    expect(elements.get('c-text')).toMatchObject({ text: 'sim', containerId: 'c' })
    expect(elements.get('a')?.boundElements).toContainEqual({ id: 'c', type: 'arrow' })
    expect(elements.has('c-path-label')).toBe(false)
  })

  it('makes a section a frame behind what it holds whole, and keeps a stamp and an icon as words', () => {
    const out = whiteboardToDraw(
      board([
        {
          id: 'sec',
          type: 'section',
          legacyGeometry: { position: { x: 0, y: 0 }, size: { x: 400, y: 400 } },
          title: 'Fluxo',
          zIndex: 9
        },
        { id: 'in', type: 'text', ...at(0, 0, 50, 20), text: words('dentro'), zIndex: 1 },
        { id: 'st', type: 'stamp', ...at(500, 0, 60, 60), stampId: 'question-mark' },
        { id: 'ic', type: 'advanced-icon', ...at(600, 0, 60, 60), iconId: 'Amazon-S3', text: '' }
      ]),
      () => undefined
    )
    const elements = byId(out.elements)
    expect(elements.get('sec')).toMatchObject({ type: 'frame', name: 'Fluxo', x: -200, y: -200 })
    expect(Number(elements.get('sec')?.z)).toBeLessThan(Number(elements.get('in')?.z))
    expect(elements.get('in')?.frameId).toBe('sec')
    expect(elements.get('st')).toMatchObject({ type: 'text', text: '[Selo: question-mark]', frameId: null })
    expect(elements.get('ic')).toMatchObject({ type: 'text', text: '[Amazon-S3]' })
    expect(boardText(out)).toBe('Fluxo\ndentro\n[Selo: question-mark]\n[Amazon-S3]')
  })

  it('draws an image from its imported file, names one the backup lacks, and keeps a pen stroke', () => {
    const out = whiteboardToDraw(
      board([
        { id: 'i1', type: 'image', ...at(0, 0, 10, 10), fileId: 'conf-1' },
        { id: 'i2', type: 'image', ...at(0, 0, 10, 10), fileId: 'conf-2' },
        {
          id: 'd1',
          type: 'drawing',
          points: JSON.parse('[{"0":10,"1":20},{"0":30,"1":25}]'),
          stroke: 'medium'
        }
      ]),
      (id) => (id === 'conf-1' ? 'draw-1' : undefined)
    )
    const elements = byId(out.elements)
    expect(elements.get('i1')).toMatchObject({ type: 'image', fileId: 'draw-1', x: -5 })
    expect(elements.get('i2')).toMatchObject({ type: 'text', text: '[Imagem do Confluence não encontrada]' })
    expect(elements.get('d1')).toMatchObject({
      type: 'freedraw',
      x: 10,
      y: 20,
      strokeWidth: 4,
      points: [
        [0, 0],
        [20, 5]
      ]
    })
  })
})
