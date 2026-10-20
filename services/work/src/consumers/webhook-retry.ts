import { createLogger } from '@jiraia/logger'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'

/** Every minute, the webhook deliveries whose next try is due (escopo-mvp 4.7). */
const service = buildService(readConfig())
const logger = createLogger('work', 'webhook-retry')

export const handler = async (): Promise<{ retried: number }> => {
  const retried = await service.webhookSender.retryDue()
  logger.record('WebhookRetries', retried)
  return { retried }
}
