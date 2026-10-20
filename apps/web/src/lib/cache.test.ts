import { describe, expect, it, vi } from 'vitest'

import { cached, clearCache, invalidate, onInvalidate } from './cache'

describe('cached', () => {
  it('loads a key once while it is cached', async () => {
    clearCache()
    const load = vi.fn(async () => 'value')

    await cached('space:1', load)
    await cached('space:1', load)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads again after its prefix is invalidated, and tells the app', async () => {
    clearCache()
    const load = vi.fn(async () => 'value')
    const changed = vi.fn()
    const stop = onInvalidate(changed)

    await cached('space:1', load)
    invalidate('space:')
    await cached('space:1', load)
    stop()

    expect(load).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed load, so the next call tries again', async () => {
    clearCache()
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('up')

    await expect(cached('me', load)).rejects.toThrow('down')
    await expect(cached('me', load)).resolves.toBe('up')
  })
})
