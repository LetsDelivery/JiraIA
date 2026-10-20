import { JiraiaException } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda'

import type { RealtimeService } from './realtime.service.js'

export type WebsocketEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined> | null
}

/**
 * One WebSocket event, as API Gateway delivers it: `$connect` with the ticket in the query string,
 * `$disconnect`, and every message on `$default`. A refusal answers with its status — a 401 on
 * `$connect` is what makes API Gateway drop the connection.
 */
export const handleRealtime = async (
  realtime: RealtimeService,
  logger: JiraiaLogger,
  event: WebsocketEvent
): Promise<APIGatewayProxyResultV2> => {
  const { routeKey, connectionId } = event.requestContext
  try {
    if (routeKey === '$connect') {
      await realtime.connect(connectionId, event.queryStringParameters?.ticket)
    } else if (routeKey === '$disconnect') {
      await realtime.disconnect(connectionId)
    } else {
      await realtime.receive(connectionId, event.body ?? '')
    }
    return { statusCode: 200 }
  } catch (error) {
    const statusCode = error instanceof JiraiaException ? error.status : 500
    logger.warn('Realtime event refused', { routeKey, connectionId, statusCode, error: String(error) })
    return { statusCode }
  }
}
