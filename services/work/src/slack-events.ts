import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import { readConfig } from './config.js'
import { buildService } from './container.js'

/**
 * What Slack sends (Etapa 5e, ADR-0018), on a route with no authorizer: the raw body and the headers go
 * to the service, which checks Slack's signature before reading anything. Built once per cold start.
 */
const service = buildService(readConfig())

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const body =
    event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '')
  const reply = await service.slackEvents.handle({ body, headers: event.headers })
  return { statusCode: reply.statusCode, headers: { 'content-type': 'application/json' }, body: reply.body }
}
