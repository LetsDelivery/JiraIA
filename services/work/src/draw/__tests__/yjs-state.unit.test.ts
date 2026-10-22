import { describe, expect, it } from 'bun:test'
import * as Y from 'yjs'

import { batchUnder } from '../content.repository.js'
import { mergeState } from '../yjs-state.js'

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const read = (state: string) => {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(state, 'base64')))
  return doc
}

/** A browser's doc that records each update it would send. */
const recording = () => {
  const doc = new Y.Doc()
  const updates: string[] = []
  doc.on('update', (update: Uint8Array) => updates.push(base64(update)))
  return { doc, updates }
}

describe('merging a stored document with its updates', () => {
  it('collects what a drag overwrote, so a board does not grow with every step', () => {
    const { doc, updates } = recording()
    const elements = doc.getMap('elements')
    for (let step = 0; step < 500; step++) {
      elements.set('box', { id: 'box', x: step, y: 0, width: 160, height: 100, strokeColor: '#1e1e1e' })
    }
    const merged = mergeState('', updates)
    const kept = base64(Y.mergeUpdates(updates.map((each) => new Uint8Array(Buffer.from(each, 'base64')))))
    expect(read(merged).getMap('elements').get('box')).toMatchObject({ x: 499 })
    expect(merged.length * 10).toBeLessThan(kept.length)
  })

  it('keeps a page as it was written, with no editor schema on the server', () => {
    const { doc, updates } = recording()
    const paragraph = new Y.XmlElement('paragraph')
    const text = new Y.XmlText()
    paragraph.insert(0, [text])
    doc.getXmlFragment('default').insert(0, [paragraph])
    text.insert(0, 'Entrega confirmada')
    text.format(0, 7, { bold: true })
    text.delete(7, 1)
    const merged = mergeState(updates[0] ?? '', updates.slice(1))
    expect(read(merged).getXmlFragment('default').toString()).toBe(doc.getXmlFragment('default').toString())
  })

  it('keeps an update that arrived before the one it builds on, and lets an old copy catch up', () => {
    const { doc, updates } = recording()
    const elements = doc.getMap('elements')
    elements.set('a', { x: 1 })
    elements.set('a', { x: 2 })
    elements.set('b', { x: 3 })
    const [first, second, third] = updates as [string, string, string]
    const early = mergeState('', [third])
    const merged = mergeState(early, [first, second])
    expect(read(merged).getMap('elements').toJSON()).toEqual({ a: { x: 2 }, b: { x: 3 } })

    const old = read(mergeState('', [first]))
    Y.applyUpdate(old, new Uint8Array(Buffer.from(merged, 'base64')))
    expect(old.getMap('elements').toJSON()).toEqual({ a: { x: 2 }, b: { x: 3 } })
  })

  it('an empty page stays an empty string', () => {
    expect(mergeState('', [])).toBe('')
  })
})

describe('reading updates under the Data API limit', () => {
  it('groups consecutive updates up to the limit, and a larger one alone', () => {
    const sizes = [40, 40, 30, 200, 10].map((length, index) => ({ id: String(index), length }))
    expect(batchUnder(sizes, 100).map((batch) => batch.map((each) => each.id))).toEqual([
      ['0', '1'],
      ['2'],
      ['3'],
      ['4']
    ])
  })
})
