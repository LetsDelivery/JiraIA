import { isJiraiaException, type JiraiaException } from '@jiraia/core'
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { z } from 'zod'

/**
 * The one response shape every endpoint returns, success or failure.
 *
 * A failure always carries `code` and never carries a stack. `traceId` is echoed so a
 * support conversation can start from what the caller saw rather than from a timestamp.
 */
export type Failure = {
  error: { code: string; message: string; details: Record<string, unknown>; traceId: string }
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const

const _send = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: JSON_HEADERS,
  body: JSON.stringify(body)
})

export const ok = (body: unknown): APIGatewayProxyStructuredResultV2 => _send(200, body)
export const created = (body: unknown): APIGatewayProxyStructuredResultV2 => _send(201, body)
export const noContent = (): APIGatewayProxyStructuredResultV2 => ({ statusCode: 204 })

export const failure = (exception: JiraiaException, traceId: string): APIGatewayProxyStructuredResultV2 =>
  _send(exception.status, {
    error: { code: exception.code, message: exception.message, details: exception.details, traceId }
  } satisfies Failure)

/**
 * Anything that is not one of ours becomes a 500 whose message says nothing.
 *
 * The real error is logged by the caller of this function. Echoing it would leak table
 * names, ARNs and hostnames to whoever provoked it.
 */
export const unexpected = (traceId: string): APIGatewayProxyStructuredResultV2 =>
  _send(500, {
    error: { code: 'INTERNAL', message: 'The request could not be completed', details: {}, traceId }
  } satisfies Failure)

export const toResponse = (error: unknown, traceId: string): APIGatewayProxyStructuredResultV2 =>
  isJiraiaException(error) ? failure(error, traceId) : unexpected(traceId)

/**
 * What every service's `/health` answers.
 *
 * Here rather than five times over, because it is the one route every service has and they all
 * answer it identically. It is also the only shape the generated contract can describe without a
 * service declaring anything (`infra/contracts/openapi.ts`).
 */
export const healthSchema = z.object({ service: z.string().min(1), status: z.literal('ok') })
