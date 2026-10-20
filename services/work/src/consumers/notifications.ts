import { createLogger } from '@jiraia/logger'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'
import { consumeBatch } from '../events/sqs.js'

/** The notifications consumer behind its own queue (ADR-0014): card and access events in, notices out. */
const service = buildService(readConfig())
const logger = createLogger('work', 'notifications')
const fanout = service.consumers.find((consumer) => consumer.name === 'notifications')

export const handler = async (batch: SQSEvent): Promise<SQSBatchResponse> => {
  if (!fanout) {
    throw new Error('The notifications consumer is not wired')
  }
  return await consumeBatch(service.receipts, fanout, batch, (messageId, error) =>
    logger.error('Notification event failed', { messageId, error: String(error) })
  )
}
