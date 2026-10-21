import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { OutboundRequest } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import type { SQSEvent } from 'aws-lambda'

import type { Consumer, DomainEvent } from '../../events/event.js'
import { cloudFormationResponder, type DeployRequest, deploy } from '../deploy.js'
import { triggerOf } from '../invoke.js'
import { consumeJobs, type JobDeps } from '../jobs.js'
import { InMemoryPanelBucket, publishPanel } from '../panel.js'
import { consumeQueue, type QueueDeps, queueOf } from '../queues.js'

const logger = createLogger('test', 'lambda')

const ARN = 'arn:aws:sqs:us-east-1:761817249596'

const _batch = (queue: string, ...bodies: string[]): SQSEvent =>
  ({
    Records: bodies.map((body, index) => ({
      messageId: `m${index}`,
      body,
      eventSource: 'aws:sqs',
      eventSourceARN: `${ARN}:${queue}`
    }))
  }) as unknown as SQSEvent

const event: DomainEvent = {
  id: '0b9b7f3e-1111-4a2b-8c3d-123456789abc',
  organizationId: '0b9b7f3e-2222-4a2b-8c3d-123456789abc',
  spaceId: null,
  actorId: '0b9b7f3e-3333-4a2b-8c3d-123456789abc',
  entityType: 'card',
  entityId: '0b9b7f3e-4444-4a2b-8c3d-123456789abc',
  action: 'moved',
  changes: {},
  occurredAt: '2026-10-21T12:00:00.000Z'
}

/** A fake of what the queues need: records which job ran and which consumer got which event. */
class RecordingWork {
  readonly ran: string[] = []
  readonly delivered: Array<{ consumer: string; id: string }> = []

  /** A step that notes it ran, then answers `result`. */
  private _step<T>(job: string, result: T) {
    return async (): Promise<T> => {
      this.ran.push(job)
      return result
    }
  }

  deps(): QueueDeps & JobDeps {
    const consumer = (name: string): Consumer => ({ name, accepts: () => true, handle: async () => undefined })
    const jobs: JobDeps = {
      dispatcher: { dispatch: this._step('dispatch', 0) },
      digest: { run: this._step('digest', { sent: 1, failed: 0 }) },
      webhookSender: { retryDue: this._step('webhook-retry', 0) },
      accessClock: { sweep: this._step('access-clock', { expired: 0, overdue: 0 }) },
      reviews: { sweep: async () => ({ opened: 0, closed: 0 }) }
    } as unknown as JobDeps
    return {
      ...jobs,
      webhookSender: { ...jobs.webhookSender, ...consumer('webhooks') },
      consumers: [consumer('automation'), consumer('notifications')],
      receipts: {
        deliver: async (target: Consumer, delivered: DomainEvent) => {
          this.delivered.push({ consumer: target.name, id: delivered.id })
          return true
        }
      }
    } as unknown as QueueDeps & JobDeps
  }
}

describe('triggerOf', () => {
  it('tells each trigger by what only it carries', () => {
    const deploying = { RequestType: 'Update', ResponseURL: 'https://cfn.counterparty.test/x', StackId: 's' }
    expect(triggerOf({ ...deploying, RequestId: 'r', LogicalResourceId: 'Deploy' })).toBe('deploy')
    expect(triggerOf(_batch('jiraia-automation', '{}'))).toBe('queue')
    expect(triggerOf({ requestContext: { connectionId: 'c1', routeKey: '$connect' } })).toBe('websocket')
    expect(triggerOf({ version: '2.0', requestContext: { http: { method: 'GET' } } })).toBe('http')
  })

  it('refuses an invocation from no trigger it has, naming what came', () => {
    expect(() => triggerOf({ source: 'aws.events' })).toThrow('keys: source')
  })
})

describe('consumeQueue', () => {
  it('names the queue by the last segment of its ARN', () => {
    expect(queueOf({ eventSourceARN: `${ARN}:jiraia-automation` })).toBe('jiraia-automation')
  })

  it('hands each queue to its own consumer', async () => {
    const work = new RecordingWork()
    const body = JSON.stringify({ 'detail-type': 'card.moved', detail: event })
    for (const queue of ['jiraia-automation', 'jiraia-notifications', 'jiraia-webhooks']) {
      await consumeQueue(work.deps(), logger, _batch(queue, body))
    }
    expect(work.delivered.map((delivery) => delivery.consumer)).toEqual(['automation', 'notifications', 'webhooks'])
  })

  it("refuses a queue it does not read, naming it — the jobs queue is the scheduler's", async () => {
    const work = new RecordingWork()
    await expect(consumeQueue(work.deps(), logger, _batch('jiraia-other', '{}'))).rejects.toThrow('"jiraia-other"')
    await expect(consumeQueue(work.deps(), logger, _batch('jiraia-jobs.fifo', '{}'))).rejects.toThrow(
      '"jiraia-jobs.fifo"'
    )
  })
})

describe('consumeJobs', () => {
  it('runs the job a schedule put in the jobs queue', async () => {
    const work = new RecordingWork()
    const result = await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"digest","at":"t"}'))
    expect(work.ran).toEqual(['digest'])
    expect(result.batchItemFailures).toEqual([])
  })

  it('hands a job message it cannot read back to its queue', async () => {
    const work = new RecordingWork()
    const result = await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"reboot"}'))
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm0' }])
  })

  it('refuses a queue other than the jobs queue, naming it', async () => {
    const work = new RecordingWork()
    await expect(consumeJobs(work.deps(), logger, _batch('jiraia-automation', '{}'))).rejects.toThrow(
      '"jiraia-automation"'
    )
  })
})

describe('deploy', () => {
  const request: DeployRequest = {
    RequestType: 'Update',
    ResponseURL: 'https://cfn.counterparty.test/answer',
    StackId: 'stack-1',
    RequestId: 'request-1',
    LogicalResourceId: 'Deploy'
  }

  const _deps = (steps: { migrate?: () => Promise<void> } = {}) => {
    const answers: Array<Record<string, unknown>> = []
    const done: string[] = []
    return {
      answers,
      done,
      deps: {
        migrate: steps.migrate ?? (async () => void done.push('migrate')),
        publishPanel: async () => {
          done.push('panel')
          return 27
        },
        respond: async (_url: string, body: string) => void answers.push(JSON.parse(body))
      }
    }
  }

  it('migrates, then publishes the panel, then answers SUCCESS', async () => {
    const run = _deps()
    await deploy(run.deps, logger, request)
    expect(run.done).toEqual(['migrate', 'panel'])
    expect(run.answers).toEqual([
      expect.objectContaining({ Status: 'SUCCESS', RequestId: 'request-1', Data: { published: 27 } })
    ])
  })

  it('answers FAILED with the reason, so the stack rolls back, and publishes nothing', async () => {
    const run = _deps({ migrate: async () => Promise.reject(new Error('Migration 0042 failed')) })
    await deploy(run.deps, logger, request)
    expect(run.done).toEqual([])
    expect(run.answers).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'Error: Migration 0042 failed' })])
  })

  it('does nothing on Delete but answer', async () => {
    const run = _deps()
    await deploy(run.deps, logger, { ...request, RequestType: 'Delete' })
    expect(run.done).toEqual([])
    expect(run.answers).toEqual([expect.objectContaining({ Status: 'SUCCESS' })])
  })
})

describe('publishPanel', () => {
  const _built = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'panel-'))
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'index.html'), '<!doctype html>')
    await writeFile(join(dir, 'config.js'), 'globalThis.JIRAIA_CONFIG = {}')
    await writeFile(join(dir, 'assets', 'main-abc123.js'), 'export {}')
    return dir
  }

  it('puts every file, caching only the hashed assets for good', async () => {
    const bucket = new InMemoryPanelBucket()
    const settings = {
      cognitoDomain: 'https://jiraia.auth.counterparty.test',
      cognitoClientId: 'c1',
      allowedEmailDomains: ['uselets.com', 'lets.delivery']
    }
    expect(await publishPanel(await _built(), bucket, settings)).toBe(3)
    expect(bucket.objects.get('assets/main-abc123.js')).toMatchObject({
      contentType: 'text/javascript; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable'
    })
    expect(bucket.objects.get('index.html')).toMatchObject({ cacheControl: 'no-cache' })
  })

  it('writes the settings of this account in place of the built ones', async () => {
    const bucket = new InMemoryPanelBucket()
    await publishPanel(await _built(), bucket, {
      cognitoDomain: 'https://jiraia-prd.auth.counterparty.test',
      cognitoClientId: 'prd-client',
      allowedEmailDomains: ['uselets.com', 'lets.delivery']
    })
    expect(bucket.objects.get('config.js')?.body).toBe(
      'globalThis.JIRAIA_CONFIG = {"cognitoDomain":"https://jiraia-prd.auth.counterparty.test","cognitoClientId":"prd-client","allowedEmailDomains":["uselets.com","lets.delivery"]}\n'
    )
  })

  it('refuses a panel that was never built, naming where it looked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'panel-'))
    await expect(
      publishPanel(dir, new InMemoryPanelBucket(), {
        cognitoDomain: '',
        cognitoClientId: '',
        allowedEmailDomains: ['x']
      })
    ).rejects.toThrow(`"${dir}"`)
  })
})

describe('cloudFormationResponder', () => {
  const _http = (status: number) => {
    const sent: OutboundRequest[] = []
    const send = async (request: OutboundRequest) => {
      sent.push(request)
      return { status, body: '' }
    }
    return { sent, http: { send } }
  }

  it('PUTs the answer with no content type, as the URL was signed for', async () => {
    const run = _http(200)
    await cloudFormationResponder(run.http)('https://cfn.counterparty.test/answer', '{"Status":"SUCCESS"}')
    expect(run.sent).toEqual([
      {
        method: 'PUT',
        url: 'https://cfn.counterparty.test/answer',
        body: '{"Status":"SUCCESS"}',
        headers: { 'content-type': '' }
      }
    ])
  })

  it('refuses an answer CloudFormation did not take, naming the status', async () => {
    await expect(cloudFormationResponder(_http(403).http)('https://cfn.counterparty.test/a', '{}')).rejects.toThrow(
      '403'
    )
  })
})
