import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GIVE_UP_MS, isResuming, RETRY_MS, resumingFetch } from './resume'

/** What the API answers while its database resumes (ADR-0035). */
const resuming = () =>
  Response.json(
    { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'x', details: { dependency: 'Database' } } },
    { status: 503 }
  )

/** A notice that counts how often it went up and how many are up now. */
const counting = () => {
  const state = { shown: 0, up: 0 }
  return {
    state,
    notice: {
      begin: () => {
        state.shown += 1
        state.up += 1
        return { end: () => (state.up -= 1) }
      }
    }
  }
}

describe('resumingFetch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks again while the database resumes, with the notice up until the data comes', async () => {
    const answers = [resuming(), resuming(), Response.json({ items: [] })]
    const bodies: string[] = []
    const send = vi.fn(async (request: Request) => {
      bodies.push(await request.text())
      return answers.shift() as Response
    })
    const { state, notice } = counting()
    const pending = resumingFetch(send, notice)(new Request('http://api/cards', { method: 'POST', body: '{"a":1}' }))
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2)
    const response = await pending
    expect(await response.json()).toEqual({ items: [] })
    expect(bodies).toEqual(['{"a":1}', '{"a":1}', '{"a":1}'])
    expect(state).toEqual({ shown: 1, up: 0 })
  })

  it('shows nothing when the database answers at once', async () => {
    const { state, notice } = counting()
    const response = await resumingFetch(async () => Response.json({ ok: true }), notice)(new Request('http://api/me'))
    expect(response.status).toBe(200)
    expect(state.shown).toBe(0)
  })

  it('hands the 503 back after GIVE_UP_MS, so the screen shows its usual refusal', async () => {
    let clock = 0
    const { state, notice } = counting()
    const pending = resumingFetch(
      async () => {
        clock += GIVE_UP_MS / 2
        return resuming()
      },
      notice,
      () => clock
    )(new Request('http://api/me'))
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3)
    expect((await pending).status).toBe(503)
    expect(state.up).toBe(0)
  })
})

describe('isResuming', () => {
  it('tells the paused database from any other 503 or refusal', async () => {
    expect(await isResuming(resuming())).toBe(true)
    const other = { error: { code: 'DEPENDENCY_UNAVAILABLE', details: { dependency: 'Anthropic' } } }
    expect(await isResuming(Response.json(other, { status: 503 }))).toBe(false)
    expect(await isResuming(new Response('gateway timeout', { status: 503 }))).toBe(false)
    expect(await isResuming(Response.json({}, { status: 500 }))).toBe(false)
  })
})
