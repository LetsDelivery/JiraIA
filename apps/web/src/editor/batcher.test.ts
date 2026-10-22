import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { BATCH_MS, UpdateBatcher } from './batcher'

const REMOTE = Symbol('remote')

/** A browser's doc wired as the provider wires it: local changes batched, remote ones received. */
const browser = (open = { value: true }) => {
  const doc = new Y.Doc()
  const sent: Uint8Array[] = []
  const each: Uint8Array[] = []
  const batcher = new UpdateBatcher(
    doc,
    (update) => sent.push(update),
    () => open.value
  )
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) {
      each.push(update)
      batcher.changed()
    }
  })
  const receive = (update: Uint8Array) => batcher.receive(() => Y.applyUpdate(doc, update, REMOTE))
  return { doc, sent, each, batcher, receive }
}

const drag = (doc: Y.Doc, steps: number) => {
  for (let step = 0; step < steps; step += 1) {
    doc.getMap('elements').set('box', { id: 'box', x: step, y: 0, width: 160, height: 100 })
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('local changes sent in batches', () => {
  it('sends a drag’s steps in one window as one update, smaller than the steps together', () => {
    const mine = browser()
    drag(mine.doc, 60)
    expect(mine.sent).toHaveLength(0)
    vi.advanceTimersByTime(BATCH_MS)
    expect(mine.sent).toHaveLength(1)
    const together = mine.each.reduce((sum, update) => sum + update.length, 0)
    expect((mine.sent[0]?.length ?? 0) * 10).toBeLessThan(together)

    const hers = browser()
    hers.receive(mine.sent[0] ?? new Uint8Array())
    expect(hers.doc.getMap('elements').get('box')).toMatchObject({ x: 59 })
  })

  it('never sends back what came from someone else', () => {
    const mine = browser()
    const hers = browser()
    drag(hers.doc, 3)
    vi.advanceTimersByTime(BATCH_MS)
    mine.receive(hers.sent[0] ?? new Uint8Array())
    vi.advanceTimersByTime(BATCH_MS)
    expect(mine.sent).toHaveLength(0)

    mine.doc.getMap('elements').set('note', { id: 'note' })
    vi.advanceTimersByTime(BATCH_MS)
    const echo = new Y.Doc()
    Y.applyUpdate(echo, mine.sent[0] ?? new Uint8Array())
    expect([...echo.getMap('elements').keys()]).toEqual(['note'])
  })

  it('sends its own changes before taking someone else’s, so both stay', () => {
    const mine = browser()
    const hers = browser()
    mine.doc.getMap('elements').set('a', { id: 'a' })
    hers.doc.getMap('elements').set('b', { id: 'b' })
    vi.advanceTimersByTime(BATCH_MS)
    mine.receive(hers.sent[0] ?? new Uint8Array())
    hers.receive(mine.sent[0] ?? new Uint8Array())
    expect([...mine.doc.getMap('elements').keys()].sort()).toEqual(['a', 'b'])
    expect([...hers.doc.getMap('elements').keys()].sort()).toEqual(['a', 'b'])
  })

  it('holds what changed while the socket is closed, and sends it all once it opens', () => {
    const open = { value: false }
    const mine = browser(open)
    drag(mine.doc, 10)
    vi.advanceTimersByTime(BATCH_MS)
    expect(mine.sent).toHaveLength(0)
    open.value = true
    mine.batcher.flush()
    const hers = browser()
    hers.receive(mine.sent[0] ?? new Uint8Array())
    expect(hers.doc.getMap('elements').get('box')).toMatchObject({ x: 9 })
  })
})
