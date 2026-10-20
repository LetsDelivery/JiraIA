import type { JiraiaLogger } from '@jiraia/logger'

/**
 * Every outbound call of the platform goes through here (infra/ci/http-gate.ts): one structured log
 * line per call — provider, host, status, duration — with sensitive headers kept out of it, and no
 * retry of its own, because the consumer's queue is the only retry that knows whether a write was
 * safe to repeat. Errors are the caller's to turn into the platform's exceptions.
 */
export type HttpClient = {
  send(request: OutboundRequest): Promise<OutboundResponse>
}

export type OutboundRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: string
  /** Gives up after this long; the default suits a webhook. */
  timeoutMs?: number
}

export type OutboundResponse = { status: number; body: string }

/** Header names whose values never reach a log line, matched without case. */
const SENSITIVE = /^(authorization|cookie|x-api-key|x-jiraia-signature|x-slack-signature)$/i

/**
 * The header names sent, with secret values masked — what a log line may say about a request.
 *
 * @example redactHeaders({ Authorization: 'Bearer x', 'Content-Type': 'a' })   // { Authorization: '***', 'Content-Type': 'a' }
 */
export const redactHeaders = (headers: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE.test(name) ? '***' : value]))

/** A URL as a log line may show it: scheme and host only, since a webhook's path is its secret. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return 'invalid-url'
  }
}

export const createHttpClient = (options: { provider: string; logger: JiraiaLogger }): HttpClient => ({
  async send(request) {
    const started = Date.now()
    const context = {
      provider: options.provider,
      host: hostOf(request.url),
      method: request.method,
      headers: redactHeaders(request.headers)
    }
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers ?? {},
        body: request.body ?? null,
        signal: AbortSignal.timeout(request.timeoutMs ?? 10_000)
      })
      const body = await response.text()
      options.logger.info('Outbound call', { ...context, status: response.status, durationMs: Date.now() - started })
      return { status: response.status, body }
    } catch (error) {
      options.logger.warn('Outbound call failed', {
        ...context,
        durationMs: Date.now() - started,
        error: String(error)
      })
      throw error
    }
  }
})
