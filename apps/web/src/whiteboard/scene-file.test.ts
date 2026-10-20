import { describe, expect, it } from 'vitest'

import { DEFAULT_STYLE, newShape } from './elements'
import { fileName } from './export'
import { readScene } from './scene-file'
import type { Whiteboard } from './whiteboard'

const board = { files: undefined } as unknown as Whiteboard

describe('scene files', () => {
  it('reads our own format, cleaning what it holds', async () => {
    const shape = newShape('rectangle', { x: 0, y: 0, width: 10, height: 10 }, DEFAULT_STYLE, 1)
    const text = JSON.stringify({
      type: 'jiraia/whiteboard',
      version: 1,
      elements: [shape, { type: 'script', id: 'x' }]
    })
    expect((await readScene(board, text)).map((each) => each.id)).toEqual([shape.id])
  })

  it('reads an Excalidraw scene: fonts, tips, the words inside, and arrows tied to the nearest side', async () => {
    const scene = {
      type: 'excalidraw',
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, roundness: { type: 3 } },
        {
          id: 't',
          type: 'text',
          x: 0,
          y: 0,
          width: 50,
          height: 20,
          text: 'quebrado',
          originalText: 'Início',
          fontFamily: 3,
          containerId: 'a'
        },
        { id: 'g', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
        {
          id: 'x',
          type: 'arrow',
          x: 106,
          y: 30,
          width: 100,
          height: 0,
          points: [
            [0, 0],
            [100, 0]
          ],
          startBinding: { elementId: 'a', focus: 0, gap: 6 },
          endArrowhead: 'crowfoot_many',
          roundness: { type: 2 }
        }
      ]
    }
    const elements = await readScene(board, JSON.stringify(scene))
    expect(elements.map((each) => each.id)).toEqual(['a', 't', 'x'])
    expect(elements[0]).toMatchObject({ roundness: 8 })
    expect(elements[1]).toMatchObject({ text: 'Início', fontFamily: 'mono' })
    expect(elements[2]).toMatchObject({
      arrowType: 'straight',
      endArrowhead: 'many',
      startBinding: { elementId: 'a', anchor: [1, 0.5] }
    })
  })

  it('refuses a file that is not a board', async () => {
    await expect(readScene(board, JSON.stringify({ hello: 'world' }))).rejects.toMatchObject({
      error: { code: 'VALIDATION_FAILED' }
    })
  })

  it('names a file after the board, without characters a file system refuses', () => {
    expect(fileName('Fluxo: pedido/entrega', 'png')).toBe('Fluxo pedido entrega.png')
    expect(fileName('', 'svg')).toBe('quadro.svg')
  })
})
