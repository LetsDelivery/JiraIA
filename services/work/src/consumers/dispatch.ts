import { createLogger } from '@jiraia/logger'

import { readConfig } from '../config.js'
import { buildService } from '../container.js'

/**
 * Every minute, moves what committed to the bus (ADR-0014). One concurrent run at a time (the
 * template reserves one), so two passes never publish the same batch.
 */
const service = buildService(readConfig())
const logger = createLogger('work', 'dispatch')

/** Passes until the outbox is empty or the minute is nearly over, whichever comes first. */
export const handler = async (): Promise<{ dispatched: number }> => {
  const started = Date.now()
  let dispatched = 0
  for (let sent = -1; sent !== 0 && Date.now() - started < 45_000; ) {
    sent = await service.dispatcher.dispatch()
    dispatched += sent
  }
  logger.record('EventsDispatched', dispatched)
  return { dispatched }
}
