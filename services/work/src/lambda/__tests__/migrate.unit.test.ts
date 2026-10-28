import { describe, expect, it } from 'bun:test'

import type { RDSDataClient } from '@aws-sdk/client-rds-data'
import { RESUMING_ERROR } from '@jiraia/db'

import { describeError } from '../deploy.js'
import { MIGRATION_RESUME, migrationClient } from '../migrate.js'

/** A Data API client whose cluster is paused for its first `pausedFor` statements. */
class PausedCluster {
  sends = 0

  constructor(private readonly pausedFor: number) {}

  async send(command: string) {
    this.sends += 1
    if (this.sends <= this.pausedFor) {
      throw Object.assign(new Error('The database is resuming'), { name: RESUMING_ERROR })
    }
    return `ran ${command}`
  }
}

describe('the migrations a deploy applies', () => {
  // Regression: a deploy that found dev's cluster paused failed on its first statement, and CloudFormation
  // rolled the stack back, while the cluster finished resuming fifteen seconds later.
  it('wait for a paused cluster to resume rather than fail the deploy', async () => {
    const cluster = new PausedCluster(7)
    const client = migrationClient(cluster as unknown as RDSDataClient, {
      ...MIGRATION_RESUME,
      sleep: async () => undefined
    })
    expect(await (client as unknown as PausedCluster).send('CREATE SCHEMA IF NOT EXISTS "drizzle"')).toBe(
      'ran CREATE SCHEMA IF NOT EXISTS "drizzle"'
    )
    expect(cluster.sends).toBe(8)
  })

  it('give a resume two minutes, inside the function timeout', () => {
    expect(MIGRATION_RESUME.waitMs()).toBe(120_000)
  })
})

describe('describeError', () => {
  it('names the cause a failed query hides', () => {
    const failed = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', {
      cause: Object.assign(new Error('The database is resuming'), { name: RESUMING_ERROR })
    })
    expect(describeError(failed)).toBe(
      'Error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" — DatabaseResumingException: The database is resuming'
    )
  })

  it('leaves an error with no cause as it is', () => {
    expect(describeError(new Error('Migration 0042 failed'))).toBe('Error: Migration 0042 failed')
  })
})
