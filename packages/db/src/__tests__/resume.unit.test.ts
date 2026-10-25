import { describe, expect, it } from 'bun:test'
import { DependencyUnavailableException } from '@jiraia/core'

import { RESUMING_ERROR, resumeAware } from '../index.js'

/** A Data API client paused for `pausedFor` sends: each answers what a paused cluster answers. */
class PausedClient {
  sends = 0

  constructor(private readonly pausedFor: number) {}

  async send(command: string) {
    this.sends += 1
    if (this.sends <= this.pausedFor) {
      throw Object.assign(new Error('The database is resuming'), { name: RESUMING_ERROR })
    }
    return `ran ${command}`
  }
}

const noSleep = async () => undefined

describe('resumeAware', () => {
  it('sends the statement again while the cluster resumes, within the wait it was given', async () => {
    const client = resumeAware(new PausedClient(3), { waitMs: () => 60_000, sleep: noSleep })
    expect(await client.send('SELECT 1')).toBe('ran SELECT 1')
    expect(client.sends).toBe(4)
  })

  it('fails at once with a 503 naming the database when the caller may not wait (ADR-0035)', async () => {
    const client = resumeAware(new PausedClient(1), { waitMs: () => 0, sleep: noSleep })
    const failure = await client.send('SELECT 1').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DependencyUnavailableException)
    expect(failure).toMatchObject({ status: 503, details: { dependency: 'Database' } })
    expect(client.sends).toBe(1)
  })

  it('passes any other failure through untouched, and reads the wait at each statement', async () => {
    const broken = resumeAware(
      { send: async () => Promise.reject(new Error('syntax error')) },
      { waitMs: () => 60_000, sleep: noSleep }
    )
    await expect(broken.send()).rejects.toThrow('syntax error')
    let waitMs = 0
    const client = resumeAware(new PausedClient(1), { waitMs: () => waitMs, sleep: noSleep })
    await expect(client.send('SELECT 1')).rejects.toBeInstanceOf(DependencyUnavailableException)
    waitMs = 60_000
    expect(await client.send('SELECT 1')).toBe('ran SELECT 1')
  })
})
