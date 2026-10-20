import { createLogger } from '@jiraia/logger'

import { readConfig } from './config.js'
import { buildService } from './container.js'
import { handleRealtime, type WebsocketEvent } from './draw/realtime-handler.js'

/**
 * The realtime entry point (ADR-0009): the WebSocket API of the pages being edited together. A second
 * Lambda of `work`, beside the router; built at module scope, once per cold start.
 */
const service = buildService(readConfig())
const logger = createLogger('work', 'realtime')

export const handler = async (event: WebsocketEvent) => await handleRealtime(service.realtime, logger, event)
