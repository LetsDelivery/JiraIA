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

type Service = ReturnType<typeof buildService>

const _http = async (service: Service, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  if (event.requestContext.http.method !== 'POST' || requestPath(event) !== SLACK_EVENTS_PATH) {
    return await service.router(event)
  }
  const body =
    event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '')
  const reply = await service.slackEvents.handle({ body, headers: event.headers })
  return { statusCode: reply.statusCode, headers: { 'content-type': 'application/json' }, body: reply.body }
}

/**
 * The general function's whole job: hand the invocation to the part of `work` that answers it.
 *
 * @example export const handler = (event: unknown) => invoke(service, deployDeps, logger, event)
 */
export const invoke = async (service: Service, deployDeps: DeployDeps, logger: JiraiaLogger, event: unknown) => {
  const trigger = triggerOf(event)
  if (trigger === 'deploy') {
    return await deploy(deployDeps, logger.child({ trigger }), deployRequestSchema.parse(event))
  }
  if (trigger === 'queue') {
    return await consumeQueue(service, logger.child({ trigger }), event as SQSEvent)
  }
  if (trigger === 'websocket') {
    return await handleRealtime(service.realtime, logger.child({ trigger }), event as WebsocketEvent)
  }
  return await _http(service, event as APIGatewayProxyEventV2)
}
