import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { drizzle as drizzleDataApi } from 'drizzle-orm/aws-data-api/pg'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { z } from 'zod'

/**
 * One Drizzle handle, two wires (ADR-0002).
 *
 * In AWS the Lambdas reach Aurora through the RDS Data API — HTTPS with IAM, no VPC, no connection
 * pool to exhaust from a thousand concurrent invocations. Locally and in the test suite there is no
 * Data API, so the same schema talks to a plain Postgres container over `pg`. Both are a
 * `PgDatabase`, so repositories are written once and never know which wire they are on.
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

/**
 * @example connectDatabase({ DATABASE_URL: 'postgres://jiraia:jiraia@localhost:8200/jiraia' })
 * @example connectDatabase({ DB_CLUSTER_ARN, DB_SECRET_ARN, DB_NAME: 'jiraia' })
 */
export const connectDatabase = (config: DbConfig): Database => {
  if ('DATABASE_URL' in config) {
    return drizzlePg(new Pool({ connectionString: config.DATABASE_URL, max: 5 })) as unknown as Database
  }

  return drizzleDataApi(new RDSDataClient({}), {
    resourceArn: config.DB_CLUSTER_ARN,
    secretArn: config.DB_SECRET_ARN,
    database: config.DB_NAME
  }) as unknown as Database
}
