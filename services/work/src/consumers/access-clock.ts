import { createLogger } from '@jiraia/logger'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'

/** Every five minutes, what access governance does on its own: expiries, overdue requests, reviews (ADR-0024). */
const service = buildService(readConfig())
const logger = createLogger('work', 'access-clock')

export const handler = async () => {
  const swept = await service.accessClock.sweep()
  const reviews = await service.reviews.sweep()
  logger.record('AccessExpired', swept.expired)
  logger.record('AccessOverdue', swept.overdue)
  logger.record('AccessReviewsOpened', reviews.opened)
  logger.record('AccessReviewsClosed', reviews.closed)
  return { ...swept, reviews }
}
