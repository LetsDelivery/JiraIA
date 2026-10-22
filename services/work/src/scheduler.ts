import { createLogger } from '@jiraia/logger'
import type { SQSEvent } from 'aws-lambda'

import { readConfig } from './config.js'
import { buildService } from './container.js'
import { consumeJobs } from './lambda/jobs.js'

/**
 * The scheduler function (ADR-0025): the jobs queue the schedules fill — dispatch, the daily summary,
 * the webhook retries and the access clock. Apart from the general function so a job's minutes never
 * compete with requests, and with only the permissions jobs need.
 *
 * Built at module scope, once per cold start; a missing variable kills it with a message naming it.
 */
const service = buildService(readConfig())
const logger = createLogger('work', 'scheduler')

export const handler = async (batch: SQSEvent) => await consumeJobs(service, logger, batch)
