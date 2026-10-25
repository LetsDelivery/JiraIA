import type { Clock, IdGenerator } from '@jiraia/core'
import { connectDatabase, type Database, type ResumePolicy } from '@jiraia/db'

import type { Config } from './config.js'
import { AwsWakeTransport } from './wake/aws-transport.js'
import { CommitSignal, signalCommits } from './wake/commit-signal.js'
import { WakePlanner } from './wake/planner.js'
import { HeldWakes, Waker, type WakeTransport } from './wake/waker.js'

/** The database, its commits signalled so the invocation can wake the dispatch (ADR-0035). */
export const connectSignalled = (config: Config, overrides: { db?: Database; resume?: ResumePolicy }) => {
  const commits = new CommitSignal()
  return { commits, db: signalCommits(overrides.db ?? connectDatabase(config, overrides.resume), commits) }
}

type WakeDeps = {
  config: Config
  clock: Clock
  ids: IdGenerator
  /** The harness's own, which runs a job in its process; the suites' to read. */
  transport: WakeTransport | undefined
  jobs: ConstructorParameters<typeof WakePlanner>[0]
}

/**
 * What wakes the jobs (ADR-0035): the planner reads when each next has work, the waker sends it. In AWS
 * the jobs queue and EventBridge Scheduler; with neither configured, the wakes are held.
 */
export const buildWake = ({ config, clock, ids, transport, jobs }: WakeDeps) => ({
  planner: new WakePlanner(jobs),
  waker: new Waker({ clock, transport: transport ?? _transport(config, ids) })
})

const _transport = (config: Config, ids: IdGenerator): WakeTransport => {
  const { JOBS_QUEUE_URL, JOBS_QUEUE_ARN, WAKE_ROLE_ARN, WAKE_SCHEDULE_GROUP } = config
  if (!JOBS_QUEUE_URL || !JOBS_QUEUE_ARN || !WAKE_ROLE_ARN || !WAKE_SCHEDULE_GROUP) {
    return new HeldWakes()
  }
  return new AwsWakeTransport(
    {
      region: config.AWS_REGION,
      queueUrl: JOBS_QUEUE_URL,
      queueArn: JOBS_QUEUE_ARN,
      roleArn: WAKE_ROLE_ARN,
      group: WAKE_SCHEDULE_GROUP
    },
    ids
  )
}
