import type { JiraiaLogger } from '@jiraia/logger'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { z } from 'zod'

import type { buildService } from '../container.js'
import { queueOf } from './queues.js'

/**
 * What JiraIA does on a clock rather than on a request: the scheduler function's whole job (ADR-0025).
 *
 * Each schedule puts `{ "job": "<name>", "at": "<time>" }` in the FIFO jobs queue, grouped by job,
 * and a FIFO group is read one message at a time: that is what keeps two passes of one job from
 * running together — which a reserved concurrency of one did when each job had its own function —
 * without a summary holding up the minute's dispatch.
 */
export const JOBS = ['dispatch', 'mail', 'morning', 'weekly', 'webhook-retry', 'access-clock'] as const

export type JobName = (typeof JOBS)[number]

/** `at` is the schedule's tick: it makes each tick's body unique, so FIFO deduplication keeps it. */
export const jobMessageSchema = z.object({ job: z.enum(JOBS), at: z.string().optional() })

type Service = ReturnType<typeof buildService>

export type JobDeps = Pick<Service, 'dispatcher' | 'mail' | 'sprints' | 'webhookSender' | 'accessClock' | 'reviews'>

/** Dispatch passes until the outbox is empty or the minute is nearly over (ADR-0014). */
const DISPATCH_BUDGET_MS = 45_000

const _dispatch = async (deps: JobDeps, logger: JiraiaLogger) => {
  const started = Date.now()
  let dispatched = 0
  for (let sent = -1; sent !== 0 && Date.now() - started < DISPATCH_BUDGET_MS; ) {
    sent = await deps.dispatcher.dispatch()
    dispatched += sent
  }
  logger.record('EventsDispatched', dispatched)
  return { dispatched }
}

/** Every minute, the e-mails that are due: mentions and access now, a card's changes after their window (Etapa 5f). */
const _mail = async (deps: JobDeps, logger: JiraiaLogger) => _recorded(await deps.mail.sendDue(), logger)

/** Every morning at 08:00 in São Paulo: sprints past their end date are marked late, then the LET’S Draw AI summary. */
const _morning = async (deps: JobDeps, logger: JiraiaLogger) => {
  const { late } = await deps.sprints.sweepLate()
  logger.record('SprintsLate', late)
  return { late, ...(await _recorded(await deps.mail.morning(), logger)) }
}

/** Mondays at 08:00 in São Paulo, the weekly summary: unanswered mentions and cards nobody took. */
const _weekly = async (deps: JobDeps, logger: JiraiaLogger) => _recorded(await deps.mail.weekly(), logger)

const _recorded = (result: { sent: number; failed: number }, logger: JiraiaLogger) => {
  logger.record('EmailsSent', result.sent)
  logger.record('EmailsFailed', result.failed)
  return result
}

/** The webhook deliveries whose next try is due (escopo-mvp 4.7). */
const _webhookRetry = async (deps: JobDeps, logger: JiraiaLogger) => {
  const retried = await deps.webhookSender.retryDue()
  logger.record('WebhookRetries', retried)
  return { retried }
}

/** What access governance does on its own: expiries, overdue requests, reviews (ADR-0024). */
const _accessClock = async (deps: JobDeps, logger: JiraiaLogger) => {
  const swept = await deps.accessClock.sweep()
  const reviews = await deps.reviews.sweep()
  logger.record('AccessExpired', swept.expired)
  logger.record('AccessOverdue', swept.overdue)
  logger.record('AccessReviewsOpened', reviews.opened)
  logger.record('AccessReviewsClosed', reviews.closed)
  return { ...swept, reviews }
}

const RUNNERS: Record<JobName, (deps: JobDeps, logger: JiraiaLogger) => Promise<object>> = {
  dispatch: _dispatch,
  mail: _mail,
  morning: _morning,
  weekly: _weekly,
  'webhook-retry': _webhookRetry,
  'access-clock': _accessClock
}

/**
 * @example await runJob(service, logger, 'morning')   // { sent: 12, failed: 0 }
 */
export const runJob = async (deps: JobDeps, logger: JiraiaLogger, job: JobName): Promise<object> =>
  await RUNNERS[job](deps, logger.child({ job }))

/** The one queue the scheduler function reads; `template.yml` names it the same. */
export const JOBS_QUEUE = 'jiraia-jobs.fifo'

/**
 * One job per message; a job that throws goes back to its FIFO group, retried before the next tick.
 *
 * @example await consumeJobs(service, logger, sqsEvent)   // { batchItemFailures: [] }
 */
export const consumeJobs = async (deps: JobDeps, logger: JiraiaLogger, batch: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchResponse['batchItemFailures'] = []
  for (const record of batch.Records) {
    if (queueOf(record) !== JOBS_QUEUE) {
      throw new Error(`Queue "${queueOf(record)}" is not the scheduler's`)
    }
    try {
      const { job } = jobMessageSchema.parse(JSON.parse(record.body))
      logger.info('Job ran', { job, result: await runJob(deps, logger, job) })
    } catch (error) {
      logger.error('Job failed', { messageId: record.messageId, error: String(error) })
      failures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures: failures }
}
