import { describeError } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { z } from 'zod'

import type { buildService } from '../container.js'
import type { Wake } from '../wake/waker.js'
import { queueOf } from './queues.js'

/**
 * What JiraIA does apart from a request: the scheduler function's whole job (ADR-0025, ADR-0035).
 *
 * Nothing runs on a clock but Monday's summary. A commit wakes the dispatch; every pass ends by planning
 * the next wake of each job from the work still pending, as a message on the FIFO jobs queue or a
 * one-time schedule. A FIFO group is read one message at a time, so two passes of one job never run
 * together, and a database with no work is never woken.
 */
export const JOBS = ['dispatch', 'mail', 'morning', 'weekly', 'webhook-retry', 'access-clock'] as const

export type JobName = (typeof JOBS)[number]

/** `at` makes each wake's body unique for FIFO deduplication; `retry` counts the passes that left the job due. */
export const jobMessageSchema = z.object({
  job: z.enum(JOBS),
  at: z.string().optional(),
  retry: z.number().int().min(0).default(0)
})

type Service = ReturnType<typeof buildService>

export type JobDeps = Pick<
  Service,
  'dispatcher' | 'mail' | 'sprints' | 'webhookSender' | 'accessClock' | 'reviews' | 'planner' | 'waker' | 'clock'
>

/** Dispatch passes until the outbox is empty or this long has gone; what is left wakes it again (ADR-0014, ADR-0035). */
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

/** The e-mails that are due: mentions and access now, a card's changes after their window (Etapa 5f). */
const _mail = async (deps: JobDeps, logger: JiraiaLogger) => _recorded(await deps.mail.sendDue(), logger)

/** At 08:00 in São Paulo, when woken for it: sprints past their end date are marked late, then the LET’S Draw AI summary. */
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

/** A job still due after its pass waits this long, doubled each pass in a row, up to `MAX_BACKOFF_MS`. */
const BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 6 * 60 * 60_000

/** A job a wake asks for, and how many passes in a row have left it due. */
export type Asked = { job: JobName; retry: number }

/**
 * The wakes a batch asked for, each read once; a message that is no wake is logged and dropped.
 *
 * @example await consumeJobs(service, logger, sqsEvent)   // { batchItemFailures: [] }
 */
export const consumeJobs = async (deps: JobDeps, logger: JiraiaLogger, batch: SQSEvent): Promise<SQSBatchResponse> => {
  const asked: Asked[] = []
  for (const record of batch.Records) {
    if (queueOf(record) !== JOBS_QUEUE) {
      throw new Error(`Queue "${queueOf(record)}" is not the scheduler's`)
    }
    const message = jobMessageSchema.safeParse(_json(record.body))
    if (message.success) {
      asked.push(message.data)
    } else {
      logger.error('Not a wake', { messageId: record.messageId, error: message.error.message })
    }
  }
  await runWakes(deps, logger, asked)
  return { batchItemFailures: [] }
}

const _json = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/**
 * Runs each job asked for once — a burst of wakes for one job is one pass — then wakes each job for its
 * next work (ADR-0035). A job that throws is not handed back to the queue: the plan finds it still due,
 * and it backs off.
 */
export const runWakes = async (deps: JobDeps, logger: JiraiaLogger, asked: readonly Asked[]): Promise<void> => {
  const ran = new Map<JobName, number>()
  for (const { job, retry } of asked) {
    if (!ran.has(job)) {
      ran.set(job, retry)
      await _runLogged(deps, logger, job)
    }
  }
  await deps.waker.wake(nextWakes(await deps.planner.plan(), ran, deps.clock.now()))
}

const _runLogged = async (deps: JobDeps, logger: JiraiaLogger, job: JobName): Promise<void> => {
  try {
    logger.info('Job ran', { job, result: await runJob(deps, logger, job) })
  } catch (error) {
    logger.error('Job failed', { job, error: describeError(error) })
  }
}

/**
 * The plan as wakes. A job that has just run and is due again at once waits its backoff instead, so a
 * job that keeps failing wakes the database less and less often.
 *
 * @example nextWakes(new Map([['mail', past]]), new Map([['mail', 2]]), now)   // [{ job: 'mail', at: now + 4 min, retry: 3 }]
 */
export const nextWakes = (plan: ReadonlyMap<JobName, Date>, ran: ReadonlyMap<JobName, number>, now: Date): Wake[] =>
  [...plan].map(([job, at]) => {
    const retry = ran.get(job)
    if (retry === undefined || at.getTime() > now.getTime()) {
      return { job, at, retry: 0 }
    }
    const wait = Math.min(BACKOFF_MS * 2 ** retry, MAX_BACKOFF_MS)
    return { job, at: new Date(now.getTime() + wait), retry: retry + 1 }
  })
