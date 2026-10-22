import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { drizzle as drizzleDataApi } from 'drizzle-orm/aws-data-api/pg'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'

/**
 * One Drizzle handle, two wires (ADR-0002).
 *
 * In AWS the Lambdas reach Aurora through the RDS Data API — HTTPS with IAM, no VPC, no connection
 * pool to exhaust from a thousand concurrent invocations. Locally and in the test suite there is no
 * Data API, so the same schema talks to a plain Postgres container over `pg` — one that refuses a
 * result over the Data API's 1 MiB as AWS does. Both are a `PgDatabase`, so repositories are written
 * once and never know which wire they are on.
 */
export type Database = PgDatabase<PgQueryResultHKT, Record<string, never>>

/** A transaction handle — the same query surface as `Database`, scoped to one unit of work. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export const dbConfigSchema = z.union([
  z.object({ DATABASE_URL: z.string().min(1) }),
  z.object({
    DB_CLUSTER_ARN: z.string().min(1),
    DB_SECRET_ARN: z.string().min(1),
    DB_NAME: z.string().min(1)
  })
])
export type DbConfig = z.infer<typeof dbConfigSchema>

/** The most the Data API answers to one statement; past it, the statement fails (ADR-0002). */
export const RESULT_LIMIT_BYTES = 1_048_576

/** A result over the limit fails here as it would in AWS — what the Data API says, its size added. */
export const assertResultSize = (rows: unknown): void => {
  const size = Buffer.byteLength(JSON.stringify(rows ?? []))
  if (size > RESULT_LIMIT_BYTES) {
    throw new Error(`Database returned more than the allowed response size limit (${size} bytes)`)
  }
}

/** Every promised query of a pool or of one of its clients, its rows checked against the limit. */
const limitResults = (client: Pool | PoolClient): void => {
  const query = client.query.bind(client) as (...args: unknown[]) => unknown
  const limited = (...args: unknown[]): unknown => {
    const result = query(...args)
    return result instanceof Promise
      ? result.then((answer: { rows?: unknown }) => {
          assertResultSize(answer?.rows)
          return answer
        })
      : result
  }
  Object.assign(client, { query: limited })
}

/** Plain Postgres that refuses what the Data API refuses, so local runs and tests meet the same wall. */
const localPool = (connectionString: string): Pool => {
  const pool = new Pool({ connectionString, max: 5 })
  limitResults(pool)
  pool.on('connect', limitResults)
  return pool
}

/**
 * @example connectDatabase({ DATABASE_URL: 'postgres://jiraia:jiraia@localhost:8200/jiraia' })
 * @example connectDatabase({ DB_CLUSTER_ARN, DB_SECRET_ARN, DB_NAME: 'jiraia' })
 */
export const connectDatabase = (config: DbConfig): Database => {
  if ('DATABASE_URL' in config) {
    return drizzlePg(localPool(config.DATABASE_URL)) as unknown as Database
  }

  return drizzleDataApi(new RDSDataClient({}), {
    resourceArn: config.DB_CLUSTER_ARN,
    secretArn: config.DB_SECRET_ARN,
    database: config.DB_NAME
  }) as unknown as Database
}
