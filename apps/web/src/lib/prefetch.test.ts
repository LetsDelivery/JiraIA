import { describe, expect, it, vi } from 'vitest'

import { PREFETCH_MS, Prefetcher } from './prefetch'

/** A prefetcher on a clock the test moves, counting its loads. */
const at = () => {
  const state = { now: 0, loads: 0 }
  const load = vi.fn(async (key: string) => `${key}#${++state.loads}`)
  return { state, load, prefetcher: new Prefetcher(load, () => state.now) }
}

describe('Prefetcher', () => {
  it('hands the click the read the hover began, without asking again', async () => {
    const { load, prefetcher } = at()
    prefetcher.warm('card-1')
    prefetcher.warm('card-1')
    expect(await prefetcher.take('card-1')).toBe('card-1#1')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('asks again once the read begun ahead is too old to show', async () => {
    const { state, prefetcher } = at()
    prefetcher.warm('card-1')
    state.now = PREFETCH_MS
    expect(await prefetcher.take('card-1')).toBe('card-1#2')
  })

  it('gives each read begun ahead once: the next opening asks the API', async () => {
    const { prefetcher } = at()
    prefetcher.warm('card-1')
    await prefetcher.take('card-1')
    expect(await prefetcher.take('card-1')).toBe('card-1#2')
  })

  it('forgets every read begun ahead when cleared, as after a write', async () => {
    const { prefetcher } = at()
    prefetcher.warm('card-1')
    prefetcher.clear()
    expect(await prefetcher.take('card-1')).toBe('card-1#2')
  })

  it('keeps a failed read begun ahead quiet until the click takes it', async () => {
    const prefetcher = new Prefetcher<string>(() => Promise.reject(new Error('503')))
    prefetcher.warm('card-1')
    await expect(prefetcher.take('card-1')).rejects.toThrow('503')
  })
})
