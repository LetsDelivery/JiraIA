import { ConflictException, CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import type { IdGenerator } from '@jiraia/core'

import type { Wake, WakeTransport } from './waker.js'

export type AwsWakeConfig = {
  region: string
  /** The FIFO jobs queue the scheduler function reads (`template.yml`, ADR-0025). */
  queueUrl: string
  queueArn: string
  /** The role EventBridge Scheduler takes to put a wake on the queue. */
  roleArn: string
  /** The schedule group the one-time wakes live in; each deletes itself once it has fired. */
  group: string
}

/** The message a job reads, whichever way it came. */
export const wakeBody = (wake: Wake): string =>
  JSON.stringify({ job: wake.job, at: wake.at.toISOString(), retry: wake.retry })

/**
 * The schedule of a job's wake at a minute: the same name for the same minute, so two passes planning
 * the same work set one schedule.
 *
 * @example scheduleName({ job: 'mail', at: new Date('2026-10-25T15:31:00Z'), retry: 0 })   // 'mail-20261025T1531'
 */
export const scheduleName = (wake: Wake): string =>
  `${wake.job}-${wake.at.toISOString().slice(0, 16).replace(/[-:]/g, '')}`

/** `at(…)` in UTC, to the second, as EventBridge Scheduler reads a one-time schedule. */
const _atExpression = (at: Date): string => `at(${at.toISOString().slice(0, 19)})`

/** SQS for now, EventBridge Scheduler for later (ADR-0035). */
export class AwsWakeTransport implements WakeTransport {
  private readonly sqs: Pick<SQSClient, 'send'>
  private readonly scheduler: Pick<SchedulerClient, 'send'>

  /** `clients` is for the suites, which hand in their own. */
  constructor(
    private readonly config: AwsWakeConfig,
    private readonly ids: IdGenerator,
    clients?: { sqs: Pick<SQSClient, 'send'>; scheduler: Pick<SchedulerClient, 'send'> }
  ) {
    this.sqs = clients?.sqs ?? new SQSClient({ region: config.region })
    this.scheduler = clients?.scheduler ?? new SchedulerClient({ region: config.region })
  }

  /** A deduplication id of its own: a wake sent after a commit must never be taken for an earlier one. */
  async now(wake: Wake): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.config.queueUrl,
        MessageBody: wakeBody(wake),
        MessageGroupId: wake.job,
        MessageDeduplicationId: this.ids.next()
      })
    )
  }

  /** A schedule already set for that minute is the same wake: it is kept. */
  async later(wake: Wake): Promise<void> {
    try {
      await this.scheduler.send(this._schedule(wake))
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error
      }
    }
  }

  private _schedule(wake: Wake): CreateScheduleCommand {
    return new CreateScheduleCommand({
      Name: scheduleName(wake),
      GroupName: this.config.group,
      ScheduleExpression: _atExpression(wake.at),
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: this.config.queueArn,
        RoleArn: this.config.roleArn,
        Input: wakeBody(wake),
        SqsParameters: { MessageGroupId: wake.job }
      }
    })
  }
}
