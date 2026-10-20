import { createLogger } from '@jiraia/logger'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'
import { consumeBatch } from '../events/sqs.js'

/** The webhooks consumer behind its own queue (ADR-0014): card events in, signed deliveries out. */
const service = buildService(readConfig())
const logger = createLogger('work', 'webhooks')

export const handler = async (batch: SQSEvent): Promise<SQSBatchResponse> =>
  await consumeBatch(service.receipts, service.webhookSender, batch, (messageId, error) =>
    logger.error('Webhook event failed', { messageId, error: String(error) })
  )
