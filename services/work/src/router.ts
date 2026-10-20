import { readConfig } from './config.js'
import { buildService } from './container.js'

/**
 * The service's HTTP entry point (one router per bounded context, ADR-0003).
 *
 * Built at module scope so the cost is paid once per cold start, and so a missing environment
 * variable kills the cold start with a message naming it.
 */
const service = buildService(readConfig())

export const handler = service.router
