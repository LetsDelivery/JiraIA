import { describe, expect, it } from 'bun:test'

import { JOBS, JOBS_QUEUE } from '../../../services/work/src/lambda/jobs.js'
import { QUEUES } from '../../../services/work/src/lambda/queues.js'
import { load, TEMPLATE_PATH } from '../cfn.js'

/**
 * What `template.yml` and the two functions must agree on (ADR-0025). None of it is seen by `tsc` or
 * by CloudFormation: a queue renamed on one side only is a batch the function refuses, and a job
 * spelled differently is a schedule that fails every tick — both in production and nowhere else.
 */
const source = await Bun.file(TEMPLATE_PATH).text()
const resources = load(source).Resources ?? {}

const _ofType = (type: string) => Object.entries(resources).filter(([, resource]) => resource.Type === type)

/** `!GetAtt AutomationQueue.Arn` reads back as `AutomationQueue.Arn`; the resource is before the dot. */
const _resource = (getAtt: unknown) => resources[String(getAtt).split('.')[0] ?? '']

const _props = (resource: (typeof resources)[string] | undefined) =>
  (resource?.Properties ?? {}) as Record<string, unknown>

describe('template.yml', () => {
  it('is plain CloudFormation, with the general function and the scheduler', () => {
    expect(source).not.toContain('AWS::Serverless')
    const handlers = _ofType('AWS::Lambda::Function').map(([name, fn]) => [name, _props(fn).Handler])
    expect(handlers).toEqual([
      ['Function', 'index.handler'],
      ['SchedulerFunction', 'scheduler.handler']
    ])
  })

  it('has each queue read by the function that knows it by that name', () => {
    const read = _ofType('AWS::Lambda::EventSourceMapping').map(([, mapping]) => [
      String(_props(mapping).FunctionName),
      String(_props(_resource(_props(mapping).EventSourceArn)).QueueName)
    ])
    expect(
      read
        .filter(([fn]) => fn === 'Function')
        .map(([, queue]) => queue)
        .sort()
    ).toEqual(Object.keys(QUEUES).sort())
    expect(read.filter(([fn]) => fn === 'SchedulerFunction').map(([, queue]) => queue)).toEqual([JOBS_QUEUE])
  })

  it('schedules only jobs the function runs, each in its own FIFO group', () => {
    const scheduled = _ofType('AWS::Events::Rule')
      .filter(([, rule]) => _props(rule).ScheduleExpression)
      .flatMap(([, rule]) => _props(rule).Targets as Array<Record<string, Record<string, unknown>>>)
      .map((target) => ({
        job: JSON.parse(String(target.InputTransformer?.InputTemplate).replace('<at>', 'tick')).job,
        group: target.SqsParameters?.MessageGroupId
      }))
    expect(scheduled.map((entry) => entry.job).sort()).toEqual([...JOBS].sort())
    expect(scheduled.every((entry) => entry.job === entry.group)).toBe(true)
  })

  it('gives every queue at least the timeout of the function that reads it', () => {
    for (const [, mapping] of _ofType('AWS::Lambda::EventSourceMapping')) {
      const timeout = Number(_props(_resource(_props(mapping).FunctionName)).Timeout)
      const visibility = Number(_props(_resource(_props(mapping).EventSourceArn)).VisibilityTimeout)
      expect(visibility).toBeGreaterThanOrEqual(timeout)
    }
  })
})
