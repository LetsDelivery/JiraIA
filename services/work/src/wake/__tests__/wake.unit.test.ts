import { describe, expect, it } from 'bun:test'
import { ConflictException } from '@aws-sdk/client-scheduler'
import { fixedClock, fixedIdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { nextWakes } from '../../lambda/jobs.js'
import { morningOf, nextMorning } from '../../sprints/days.js'
import { AwsWakeTransport, scheduleName, wakeBody } from '../aws-transport.js'
import { CommitSignal, signalCommits } from '../commit-signal.js'
import { earliestOf } from '../times.js'
import { earliest, HeldWakes, nextMinute, Waker } from '../waker.js'

const NOW = new Date('2026-10-25T15:00:20.000Z')

/** An SDK client that keeps each command's input, and may refuse with `refusal`. */
class RecordingClient {
  readonly inputs: Array<Record<string, unknown>> = []

  constructor(private readonly refusal?: Error) {}

  async send(command: { input: Record<string, unknown> }) {
    this.inputs.push(command.input)
    if (this.refusal) {
      throw this.refusal
    }
    return {}
  }
}

const CONFIG = {
  region: 'us-east-1',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/761817249596/jiraia-jobs.fifo',
  queueArn: 'arn:aws:sqs:us-east-1:761817249596:jiraia-jobs.fifo',
  roleArn: 'arn:aws:iam::761817249596:role/jiraia-wake',
  group: 'jiraia-wakes'
}

describe('Waker', () => {
  const waker = (transport: HeldWakes) => new Waker({ clock: fixedClock(NOW), transport })

  it('puts a job due now on the queue, and one due later at the minute it falls in', async () => {
    const held = new HeldWakes()
    await waker(held).wake([
      { job: 'dispatch', at: NOW, retry: 0 },
      { job: 'mail', at: new Date('2026-10-25T15:10:05.000Z'), retry: 0 }
    ])
    expect(held.held).toEqual([
      { job: 'dispatch', at: NOW, retry: 0 },
      { job: 'mail', at: new Date('2026-10-25T15:11:00.000Z'), retry: 0 }
    ])
  })

  it('sets a wake due in a moment far enough ahead that its schedule is never in the past', async () => {
    const held = new HeldWakes()
    await waker(held).wake([{ job: 'mail', at: new Date('2026-10-25T15:00:55.000Z'), retry: 0 }])
    expect(held.held[0]?.at).toEqual(new Date('2026-10-25T15:01:00.000Z'))
    const late = new HeldWakes()
    await new Waker({ clock: fixedClock(new Date('2026-10-25T15:00:55.000Z')), transport: late }).wake([
      { job: 'mail', at: new Date('2026-10-25T15:00:58.000Z'), retry: 0 }
    ])
    expect(late.held[0]?.at).toEqual(new Date('2026-10-25T15:02:00.000Z'))
  })

  it('sends each job its earliest wake only', () => {
    const first = { job: 'mail' as const, at: new Date('2026-10-25T15:05:00.000Z'), retry: 0 }
    expect(earliest([{ ...first, at: new Date('2026-10-25T16:00:00.000Z') }, first])).toEqual([first])
    expect(nextMinute(new Date('2026-10-25T15:05:00.000Z'))).toEqual(new Date('2026-10-25T15:05:00.000Z'))
  })
})

describe('AwsWakeTransport', () => {
  const wake = { job: 'access-clock' as const, at: new Date('2026-10-25T15:31:00.000Z'), retry: 1 }

  it('sends a wake for now on the FIFO queue, grouped by job, never deduplicated against an earlier one', async () => {
    const sqs = new RecordingClient()
    const transport = new AwsWakeTransport(CONFIG, fixedIdGenerator(['a', 'b']), { sqs, scheduler: sqs })
    await transport.now(wake)
    await transport.now(wake)
    expect(sqs.inputs.map((input) => input.MessageDeduplicationId)).toEqual(['a', 'b'])
    expect(sqs.inputs[0]).toMatchObject({ QueueUrl: CONFIG.queueUrl, MessageGroupId: 'access-clock' })
    expect(JSON.parse(String(sqs.inputs[0]?.MessageBody))).toEqual({
      job: 'access-clock',
      at: '2026-10-25T15:31:00.000Z',
      retry: 1
    })
  })

  it('sets a wake for later as a one-time schedule that deletes itself once fired', async () => {
    const scheduler = new RecordingClient()
    await new AwsWakeTransport(CONFIG, fixedIdGenerator([]), { sqs: scheduler, scheduler }).later(wake)
    expect(scheduler.inputs[0]).toMatchObject({
      Name: 'access-clock-20261025T1531',
      GroupName: 'jiraia-wakes',
      ScheduleExpression: 'at(2026-10-25T15:31:00)',
      ScheduleExpressionTimezone: 'UTC',
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: CONFIG.queueArn,
        RoleArn: CONFIG.roleArn,
        Input: wakeBody(wake),
        SqsParameters: { MessageGroupId: 'access-clock' }
      }
    })
  })

  it('keeps a schedule already set for that minute, and passes any other refusal on', async () => {
    // What the SDK throws for a name already taken, without building its wire metadata.
    const exists = Object.assign(Object.create(ConflictException.prototype) as Error, { message: 'exists' })
    const kept = new RecordingClient(exists)
    await new AwsWakeTransport(CONFIG, fixedIdGenerator([]), { sqs: kept, scheduler: kept }).later(wake)
    const refused = new RecordingClient(new Error('AccessDenied'))
    const transport = new AwsWakeTransport(CONFIG, fixedIdGenerator([]), { sqs: refused, scheduler: refused })
    await expect(transport.later(wake)).rejects.toThrow('AccessDenied')
    expect(scheduleName(wake)).toBe('access-clock-20261025T1531')
  })
})

describe('nextWakes', () => {
  const now = new Date('2026-10-25T15:00:00.000Z')

  it('wakes a job that did not run when its work is due, now or later', () => {
    const later = new Date('2026-10-26T11:00:00.000Z')
    const plan = new Map([
      ['dispatch', now],
      ['morning', later]
    ] as const)
    expect(nextWakes(plan, new Map(), now)).toEqual([
      { job: 'dispatch', at: now, retry: 0 },
      { job: 'morning', at: later, retry: 0 }
    ])
  })

  it('backs off a job that ran and is still due, doubling, at most six hours', () => {
    const plan = new Map([['mail', now]] as const)
    expect(nextWakes(plan, new Map([['mail', 0]]), now)).toEqual([
      { job: 'mail', at: new Date('2026-10-25T15:01:00.000Z'), retry: 1 }
    ])
    expect(nextWakes(plan, new Map([['mail', 20]]), now)[0]?.at).toEqual(new Date('2026-10-25T21:00:00.000Z'))
  })

  it('starts the count again once a job that ran has nothing left due now', () => {
    const later = new Date('2026-10-25T15:10:00.000Z')
    expect(nextWakes(new Map([['mail', later]]), new Map([['mail', 4]]), now)).toEqual([
      { job: 'mail', at: later, retry: 0 }
    ])
  })
})

describe('signalCommits', () => {
  /** A database that runs a transaction as the drivers do, or fails it. */
  const database = (fails: boolean) =>
    ({
      name: 'fake',
      transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        const result = await run({})
        if (fails) {
          throw new Error('rolled back')
        }
        return result
      }
    }) as unknown as Database

  it('marks the signal once a transaction commits, and only then', async () => {
    const signal = new CommitSignal()
    const db = signalCommits(database(false), signal)
    expect(await db.transaction(async () => 42)).toBe(42)
    expect(signal.take()).toBe(true)
    expect(signal.take()).toBe(false)
    await expect(signalCommits(database(true), signal).transaction(async () => 1)).rejects.toThrow('rolled back')
    expect(signal.take()).toBe(false)
  })

  it('leaves the database it was given as it was', async () => {
    const original = database(false)
    const signal = new CommitSignal()
    signalCommits(original, signal)
    await original.transaction(async () => 1)
    expect(signal.take()).toBe(false)
    expect((signalCommits(original, signal) as unknown as { name: string }).name).toBe('fake')
  })
})

describe('times', () => {
  it('takes the earliest moment, leaving out those absent', () => {
    const first = new Date('2026-10-25T15:00:00.000Z')
    expect(earliestOf(null, new Date('2026-10-26T00:00:00.000Z'), first, null)).toEqual(first)
    expect(earliestOf(null, null)).toBeNull()
  })

  it('puts the morning job at 08:00 in São Paulo, today if it has not come, else tomorrow', () => {
    expect(morningOf('2026-10-26')).toEqual(new Date('2026-10-26T11:00:00.000Z'))
    expect(nextMorning(new Date('2026-10-26T10:59:00.000Z'))).toEqual(new Date('2026-10-26T11:00:00.000Z'))
    expect(nextMorning(new Date('2026-10-26T11:00:00.000Z'))).toEqual(new Date('2026-10-27T11:00:00.000Z'))
    // 23:30 in São Paulo is already the next day in UTC; the next 08:00 is still the following morning.
    expect(nextMorning(new Date('2026-10-27T02:30:00.000Z'))).toEqual(new Date('2026-10-27T11:00:00.000Z'))
  })
})
