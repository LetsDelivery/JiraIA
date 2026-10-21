import { createLogger } from '@jiraia/logger'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'

/** Every five minutes, what access governance does on its own: expiries and overdue requests (ADR-0024). */
const service = buildService(readConfig())
const logger = createLogger('work', 'access-clock')

export const handler = async (): Promise<{ expired: number; overdue: number }> => {
  const swept = await service.accessClock.sweep()
  logger.record('AccessExpired', swept.expired)
  logger.record('AccessOverdue', swept.overdue)
  return swept
}
