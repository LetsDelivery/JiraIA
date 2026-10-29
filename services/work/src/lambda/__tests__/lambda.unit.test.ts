import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fixedClock } from '@jiraia/core'
import type { OutboundRequest } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import type { SQSEvent } from 'aws-lambda'

import type { Consumer, DomainEvent } from '../../events/event.js'
import { CommitSignal } from '../../wake/commit-signal.js'
import { HeldWakes, Waker } from '../../wake/waker.js'
import type { DeployDeps } from '../deploy.js'
import { cloudFormationResponder, type DeployRequest, deploy } from '../deploy.js'
import { invoke, triggerOf } from '../invoke.js'
import { consumeJobs, type JobDeps, type JobName } from '../jobs.js'
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

const NOW = new Date('2026-10-25T15:00:00.000Z')
const LATER = new Date('2026-10-25T15:40:00.000Z')

/**
 * A fake of what the queues need: records which job ran and which consumer got which event, plans
 * what `plan` says and keeps the wakes it is asked for.
 */
class RecordingWork {
  readonly ran: string[] = []
  readonly delivered: Array<{ consumer: string; id: string }> = []
  readonly wakes = new HeldWakes()
  readonly commits = new CommitSignal()
  plan = new Map<JobName, Date>()
  failing: string | undefined

  /** A step that notes it ran, then answers `result`. */
  private _step<T>(job: string, result: T) {
    return async (): Promise<T> => {
      this.ran.push(job)
      if (this.failing === job) {
        throw new Error(`${job} broke`)
      }
      return result
    }
  }

  deps(): QueueDeps & JobDeps {
    const consumer = (name: string): Consumer => ({ name, accepts: () => true, handle: async () => undefined })
    const jobs: JobDeps = {
      dispatcher: { dispatch: this._step('dispatch', 0) },
      mail: {
        sendDue: this._step('mail', { sent: 1, failed: 0 }),
        morning: this._step('morning', { sent: 1, failed: 0 }),
        weekly: this._step('weekly', { sent: 1, failed: 0 })
      },
      sprints: { sweepLate: async () => ({ late: 0 }) },
      webhookSender: { retryDue: this._step('webhook-retry', 0) },
      accessClock: { sweep: this._step('access-clock', { expired: 0, overdue: 0 }) },
      reviews: { sweep: async () => ({ opened: 0, closed: 0 }) },
      planner: { plan: async () => this.plan },
      waker: new Waker({ clock: fixedClock(NOW), transport: this.wakes }),
      clock: fixedClock(NOW)
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
  it('runs the job a wake put in the jobs queue', async () => {
    const work = new RecordingWork()
    const result = await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"weekly","at":"t"}'))
    expect(work.ran).toEqual(['weekly'])
    expect(result.batchItemFailures).toEqual([])
  })

  it('runs a burst of wakes for one job as one pass', async () => {
    const work = new RecordingWork()
    const wake = '{"job":"dispatch","at":"t"}'
    await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', wake, wake, '{"job":"mail"}', wake))
    expect(work.ran).toEqual(['dispatch', 'mail'])
  })

  it('drops a message that is no wake instead of handing it back forever', async () => {
    const work = new RecordingWork()
    const result = await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"reboot"}', 'not json'))
    expect(work.ran).toEqual([])
    expect(result.batchItemFailures).toEqual([])
  })

  it('ends by waking each job for its next work, and nothing when none is pending (ADR-0035)', async () => {
    const work = new RecordingWork()
    await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"dispatch"}'))
    expect(work.wakes.held).toEqual([])
    work.plan = new Map([['mail', LATER]])
    await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"dispatch"}'))
    expect(work.wakes.held).toEqual([{ job: 'mail', at: LATER, retry: 0 }])
  })

  it('backs a job off when its pass failed and left it due, rather than run it again at once', async () => {
    const work = new RecordingWork()
    work.failing = 'mail'
    work.plan = new Map([['mail', NOW]])
    const result = await consumeJobs(work.deps(), logger, _batch('jiraia-jobs.fifo', '{"job":"mail","retry":2}'))
    expect(result.batchItemFailures).toEqual([])
    expect(work.wakes.held).toEqual([{ job: 'mail', at: new Date('2026-10-25T15:04:00.000Z'), retry: 3 }])
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

describe('invoke', () => {
  const deployDeps = {} as DeployDeps
  const http = { version: '2.0', requestContext: { http: { method: 'POST' } }, rawPath: '/cards', headers: {} }

  /** The service as `invoke` reads it: a router that may commit, and what wakes the dispatch. */
  const service = (work: RecordingWork, commits: boolean) =>
    ({
      ...work.deps(),
      commits: work.commits,
      router: async () => {
        if (commits) {
          work.commits.mark()
        }
        return { statusCode: 200 }
      }
    }) as unknown as Parameters<typeof invoke>[0]

  it('wakes the dispatch after a request that committed, once (ADR-0035)', async () => {
    const work = new RecordingWork()
    await invoke(service(work, true), deployDeps, logger, http)
    expect(work.wakes.held).toEqual([{ job: 'dispatch', at: NOW, retry: 0 }])
    expect(work.commits.take()).toBe(false)
  })

  it('wakes nothing after a request that only read, so the database is left to pause', async () => {
    const work = new RecordingWork()
    await invoke(service(work, false), deployDeps, logger, { ...http, requestContext: { http: { method: 'GET' } } })
    expect(work.wakes.held).toEqual([])
  })

  it('wakes the dispatch after every queue batch: a consumer may write outside a transaction', async () => {
    const work = new RecordingWork()
    await invoke(service(work, false), deployDeps, logger, _batch('jiraia-webhooks', JSON.stringify({ detail: event })))
    expect(work.wakes.held.map((wake) => wake.job)).toEqual(['dispatch'])
  })

  it('hands Slack’s and GitHub’s signed deliveries their raw body, past the router (ADR-0018, ADR-0038)', async () => {
    const work = new RecordingWork()
    const heard: string[] = []
    const signed = (who: string) => ({
      handle: async (request: { body: string }) => {
        heard.push(`${who}:${request.body}`)
        return { statusCode: 200, body: '' }
      }
    })
    const both = {
      ...service(work, false),
      slackEvents: signed('slack'),
      githubEvents: signed('github')
    } as unknown as Parameters<typeof invoke>[0]
    const body = Buffer.from('{"zen":"x"}').toString('base64')
    const at = (path: string) => ({ ...http, requestContext: { http: { method: 'POST', path } } })
    await invoke(both, deployDeps, logger, { ...at('/github/events'), body, isBase64Encoded: true })
    await invoke(both, deployDeps, logger, { ...at('/slack/events'), body: '{}' })
    expect(heard).toEqual(['github:{"zen":"x"}', 'slack:{}'])
  })

  it('answers even when the wake cannot be sent, and says so in the log', async () => {
    const work = new RecordingWork()
    work.wakes.now = async () => {
      throw new Error('SQS is down')
    }
    expect(await invoke(service(work, true), deployDeps, logger, http)).toEqual({ statusCode: 200 })
  })
})
