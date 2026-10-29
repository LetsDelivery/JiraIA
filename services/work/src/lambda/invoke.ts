import { describeError } from '@jiraia/core'
import { requestPath } from '@jiraia/http'
import type { JiraiaLogger } from '@jiraia/logger'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, SQSEvent } from 'aws-lambda'
import { z } from 'zod'

import type { buildService } from '../container.js'
import { handleRealtime, type WebsocketEvent } from '../draw/realtime-handler.js'
import { type DeployDeps, deploy, deployRequestSchema } from './deploy.js'
import { consumeQueue } from './queues.js'

/**
 * Which of the function's triggers an invocation came from (ADR-0025): the HTTP API, the WebSocket
 * API, a queue, or the deploy. Each shape is told apart by what only it carries.
 */
const queueSchema = z.object({
  Records: z.array(z.object({ eventSource: z.literal('aws:sqs'), eventSourceARN: z.string() })).min(1)
})
const websocketSchema = z.object({ requestContext: z.object({ connectionId: z.string(), routeKey: z.string() }) })
const httpSchema = z.object({
  version: z.literal('2.0'),
  requestContext: z.object({ http: z.object({ method: z.string() }) })
})

export type Trigger = 'deploy' | 'queue' | 'websocket' | 'http'

/**
 * @example triggerOf({ RequestType: 'Update', ResponseURL: 'https://…', … })   // 'deploy'
 */
export const triggerOf = (event: unknown): Trigger => {
  if (deployRequestSchema.safeParse(event).success) {
    return 'deploy'
  }
  if (queueSchema.safeParse(event).success) {
    return 'queue'
  }
  if (websocketSchema.safeParse(event).success) {
    return 'websocket'
  }
  if (httpSchema.safeParse(event).success) {
    return 'http'
  }
  const keys = event && typeof event === 'object' ? Object.keys(event).join(', ') : typeof event
  throw new Error(`An invocation from no trigger this function has (keys: ${keys})`)
}

/** Slack's events skip the router (ADR-0018): the service checks Slack's signature on the raw body. */
export const SLACK_EVENTS_PATH = '/slack/events'
/** GitHub's deliveries skip it too (ADR-0038), for the same reason. */
export const GITHUB_EVENTS_PATH = '/github/events'

type Service = ReturnType<typeof buildService>
type Signed = {
  handle(request: {
    body: string
    headers: Record<string, string | undefined>
  }): Promise<{ statusCode: number; body: string }>
}

/** Who answers a path whose sender signs its raw body, if this path is one. */
const signedBy = (service: Service, event: APIGatewayProxyEventV2): Signed | undefined => {
  if (event.requestContext.http.method !== 'POST') {
    return undefined
  }
  const path = requestPath(event)
  return path === SLACK_EVENTS_PATH
    ? service.slackEvents
    : path === GITHUB_EVENTS_PATH
      ? service.githubEvents
      : undefined
}

const _http = async (service: Service, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const signed = signedBy(service, event)
  if (!signed) {
    return await service.router(event)
  }
  const body =
    event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '')
  const reply = await signed.handle({ body, headers: event.headers })
  return { statusCode: reply.statusCode, headers: { 'content-type': 'application/json' }, body: reply.body }
}

/**
 * The general function's whole job: hand the invocation to the part of `work` that answers it, then
 * wake the dispatch if anything committed (ADR-0035). A queue's consumers may write outside a
 * transaction — a webhook's next try — so a queue batch always wakes it; and a deploy does, so the
 * work pending when it landed is planned again.
 *
 * @example export const handler = (event: unknown) => invoke(service, deployDeps, logger, event)
 */
export const invoke = async (service: Service, deployDeps: DeployDeps, logger: JiraiaLogger, event: unknown) => {
  const trigger = triggerOf(event)
  const answer = await _answer(service, deployDeps, logger.child({ trigger }), trigger, event)
  if (service.commits.take() || trigger === 'queue' || trigger === 'deploy') {
    await wakeDispatch(service, logger)
  }
  return answer
}

const _answer = async (
  service: Service,
  deployDeps: DeployDeps,
  logger: JiraiaLogger,
  trigger: Trigger,
  event: unknown
) => {
  if (trigger === 'deploy') {
    return await deploy(deployDeps, logger, deployRequestSchema.parse(event))
  }
  if (trigger === 'queue') {
    return await consumeQueue(service, logger, event as SQSEvent)
  }
  if (trigger === 'websocket') {
    return await handleRealtime(service.realtime, logger, event as WebsocketEvent)
  }
  return await _http(service, event as APIGatewayProxyEventV2)
}

/**
 * The dispatch, now; its pass plans every other job. A wake that fails is logged, not thrown: the
 * answer stands, and the work waits for the next commit to wake it.
 */
export const wakeDispatch = async (service: Pick<Service, 'waker' | 'clock'>, logger: JiraiaLogger) => {
  try {
    await service.waker.wake([{ job: 'dispatch', at: service.clock.now(), retry: 0 }])
  } catch (error) {
    logger.error('Wake failed', { job: 'dispatch', error: describeError(error) })
  }
}
