import { DependencyUnavailableException } from '@jiraia/core'
import type { HttpClient, OutboundResponse } from '@jiraia/http'
import { z } from 'zod'

import type { Raw } from './atlassian-source.js'

/**
 * Where and as whom the importer reads. A scoped token only answers on `api.atlassian.com`, under the
 * site's cloud id; the site's own address refuses it. Each app has its own token (ADR-0036).
 */
export type AtlassianCredentials = {
  cloudId: string
  email: string
  jiraToken: string
  confluenceToken: string
  apiUrl?: string
}

export type Sleep = (ms: number) => Promise<void>
export const realSleep: Sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const RETRIES = 5
const rawSchema = z.record(z.string(), z.unknown())

/** `@jiraia/http` does not hand back Atlassian's `Retry-After`, so the wait doubles from 2s. */
const backoff = (attempt: number): number => 2_000 * 2 ** (attempt - 1)

/**
 * One Atlassian app's REST API, read-only, as one account. A 429 waits and asks again: every call
 * here is a read, so repeating it is safe — the one retry `@jiraia/http` leaves to its caller.
 */
export class AtlassianHttp {
  private readonly auth: string

  constructor(
    private readonly http: HttpClient,
    private readonly app: { name: 'Jira' | 'Confluence'; base: string; email: string; token: string },
    private readonly sleep: Sleep = realSleep
  ) {
    this.auth = `Basic ${Buffer.from(`${app.email}:${app.token}`).toString('base64')}`
  }

  async json(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    return JSON.parse((await this.request(method, path, body)).body)
  }

  async object(path: string): Promise<Raw> {
    return rawSchema.parse(await this.json('GET', path))
  }

  async bytes(path: string): Promise<Uint8Array> {
    return (await this.request('GET', path, undefined, true)).bytes ?? new Uint8Array()
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    binary = false,
    attempt = 1
  ): Promise<OutboundResponse> {
    const response = await this.http.send({
      method,
      url: this.app.base + path,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: binary ? 120_000 : 30_000,
      binary
    })
    if (response.status === 429 && attempt < RETRIES) {
      await this.sleep(backoff(attempt))
      return await this.request(method, path, body, binary, attempt + 1)
    }
    if (response.status !== 200) {
      throw new DependencyUnavailableException(
        this.app.name,
        `${method} ${path.split('?')[0]} answered ${response.status}`
      )
    }
    return response
  }
}
