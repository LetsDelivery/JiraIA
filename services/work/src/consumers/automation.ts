import { createLogger } from '@jiraia/logger'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'
import { consumeBatch } from '../events/sqs.js'

/** The automation consumer behind its own queue (ADR-0014): card events in, rules run. */
const service = buildService(readConfig())
const logger = createLogger('work', 'automation')
const engine = service.consumers.find((consumer) => consumer.name === 'automation')

export const handler = async (batch: SQSEvent): Promise<SQSBatchResponse> => {
  if (!engine) {
    throw new Error('The automation consumer is not wired')
  }
  return await consumeBatch(service.receipts, engine, batch, (messageId, error) =>
    logger.error('Automation event failed', { messageId, error: String(error) })
  )
}
