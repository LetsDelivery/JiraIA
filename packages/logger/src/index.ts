import { Logger } from '@aws-lambda-powertools/logger'
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics'

/**
 * Structured logging and EMF metrics, behind the thin interface this project owns.
 *
 * Powertools is wrapped rather than imported directly for the reason the style guide
 * gives — a third-party API should not appear in domain code — but also for a concrete
 * one: `traceId` has to appear on every line so that an HTTP request, the event it
 * publishes, the SQS message that carries it and the carrier call at the end can be
 * stitched together (ADR: observability is CloudWatch, correlation is ours to carry).
 * A bare `logger.info` cannot be trusted to remember that.
 */

export type LogContext = Record<string, unknown>

export type JiraiaLogger = {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
  /** A child logger that repeats `context` on every line it writes. */
  child: (context: LogContext) => JiraiaLogger
  count: (metric: string, dimensions?: Record<string, string>) => void
  /**
   * Publishes a metric with a value, where `count` publishes one occurrence.
   *
   * The distinction is what an alarm needs. "A sweep ran" is a count; "a sweep left 240 decisions
   * for the next one" is a value, and only the second can carry a threshold. Emit it on every run
   * including the empty ones — an alarm on a metric that is published only when there is something
   * to report cannot tell a quiet platform from a job that stopped happening, and will sit in
   * `INSUFFICIENT_DATA` reporting nothing wrong.
   */
  record: (metric: string, value: number, dimensions?: Record<string, string>) => void
}

const wrap = (logger: Logger, metrics: Metrics): JiraiaLogger => ({
  debug: (message, context) => logger.debug(message, context ?? {}),
  info: (message, context) => logger.info(message, context ?? {}),
  warn: (message, context) => logger.warn(message, context ?? {}),
  error: (message, context) => logger.error(message, context ?? {}),
  child: (context) => wrap(logger.createChild({ persistentKeys: context }), metrics),
  count: (metric, dimensions) => {
    // A fresh single-metric emission per call: EMF aggregates by dimension set, and
    // mutating the shared instance would leak dimensions into unrelated metrics.
    const scoped = metrics.singleMetric()
    if (dimensions) {
      scoped.addDimensions(dimensions)
    }
    scoped.addMetric(metric, MetricUnit.Count, 1)
  },
  record: (metric, value, dimensions) => {
    const scoped = metrics.singleMetric()
    if (dimensions) {
      scoped.addDimensions(dimensions)
    }
    scoped.addMetric(metric, MetricUnit.Count, value)
  }
})

/**
 * @example
 * const logger = createLogger('work', 'spaces')
 * logger.child({ traceId }).info('Space created', { spaceId })
 */
export const createLogger = (service: string, component: string): JiraiaLogger => {
  const namespace = `jiraia/${service}`

  return wrap(
    new Logger({ serviceName: `${service}.${component}`, persistentKeys: { component } }),
    new Metrics({ namespace, serviceName: service })
  )
}
