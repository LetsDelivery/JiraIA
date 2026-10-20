import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { z } from 'zod'

import { type Consumer, type DomainEvent, domainEventSchema } from './event.js'
import type { Receipts } from './receipts.js'

/** What EventBridge puts in a queue: its own envelope, with our event as `detail`. */
const envelopeSchema = z.object({ 'detail-type': z.string(), detail: domainEventSchema })

/**
 * The event inside one SQS message body.
 *
 * @example eventOf('{"detail-type":"card.moved","detail":{…}}')   // the card.moved event
 */
export const eventOf = (body: string): DomainEvent => envelopeSchema.parse(JSON.parse(body)).detail

/**
 * Hands a queue's batch to one consumer. A message that fails goes back to the queue alone (partial
 * batch response); after the queue's retries it lands in the dead-letter queue, which raises an alarm.
 */
export const consumeBatch = async (
  receipts: Receipts,
  consumer: Consumer,
  batch: SQSEvent,
  onError: (messageId: string, error: unknown) => void
): Promise<SQSBatchResponse> => {
  const failures: SQSBatchResponse['batchItemFailures'] = []
  for (const record of batch.Records) {
    try {
      await receipts.deliver(consumer, eventOf(record.body))
    } catch (error) {
      onError(record.messageId, error)
      failures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures: failures }
}
