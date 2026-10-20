import { createLogger } from '@jiraia/logger'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'

/** Every morning at 08:00 in São Paulo, the daily summary of unread notices (escopo-mvp 4.6). */
const service = buildService(readConfig())
const logger = createLogger('work', 'digest')

export const handler = async (): Promise<{ sent: number; failed: number }> => {
  const result = await service.digest.run()
  logger.record('SummariesSent', result.sent)
  logger.record('SummariesFailed', result.failed)
  return result
}
