import type { JiraiaLogger } from '@jiraia/logger'
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'

import type { buildService } from '../container.js'
import { consumeBatch } from '../events/sqs.js'

/**
 * The queues the general function reads, by the name `template.yml` gives each (ADR-0025): one per
 * domain-event consumer (ADR-0014). One event source mapping hands over one queue's batch at a time,
 * so the queue of its first record names them all. The jobs queue is the scheduler's (`jobs.ts`).
 */
export const QUEUES = {
  'jiraia-automation': 'automation',
  'jiraia-notifications': 'notifications',
  'jiraia-webhooks': 'webhooks'
} as const

type QueueName = keyof typeof QUEUES

type Service = ReturnType<typeof buildService>

export type QueueDeps = Pick<Service, 'receipts' | 'consumers' | 'webhookSender'>

/**
 * The queue a record came from: the last segment of its ARN.
 *
 * @example queueOf(record)   // 'jiraia-automation' for arn:aws:sqs:us-east-1:123:jiraia-automation
 */
export const queueOf = (record: Pick<SQSRecord, 'eventSourceARN'>): string =>
  record.eventSourceARN.split(':').at(-1) ?? ''

const _isKnown = (name: string): name is QueueName => Object.hasOwn(QUEUES, name)

/** The domain-event consumer wired under `name` (ADR-0014), or a refusal naming it. */
const _consumer = (deps: QueueDeps, name: 'automation' | 'notifications') => {
  const consumer = deps.consumers.find((candidate) => candidate.name === name)
  if (!consumer) {
    throw new Error(`The ${name} consumer is not wired`)
  }
  return consumer
}

/**
 * @example await consumeQueue(service, logger, sqsEvent)   // { batchItemFailures: [] }
 */
export const consumeQueue = async (
  deps: QueueDeps,
  logger: JiraiaLogger,
  batch: SQSEvent
): Promise<SQSBatchResponse> => {
  const name = queueOf(batch.Records[0] ?? { eventSourceARN: '' })
  if (!_isKnown(name)) {
    throw new Error(`Queue "${name}" is not one this function reads`)
  }
  const kind = QUEUES[name]
  const consumer = kind === 'webhooks' ? deps.webhookSender : _consumer(deps, kind)
  return await consumeBatch(deps.receipts, consumer, batch, (messageId, error) =>
    logger.error('Event failed', { queue: name, messageId, error: String(error) })
  )
}
