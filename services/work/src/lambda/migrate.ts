import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { readEnv } from '@jiraia/core'
import { drizzle } from 'drizzle-orm/aws-data-api/pg'
import { migrate } from 'drizzle-orm/aws-data-api/pg/migrator'
import { z } from 'zod'

/**
 * Applies this service's migrations to Aurora through the Data API (ADR-0002).
 *
 * Run by the deploy — the stack's `Deploy` custom resource (ADR-0025) — never on a request path. The
 * migrations travel inside the function's package (`infra/build`), so a deploy can only ever apply
 * the migrations of the code it is shipping.
 */
const configSchema = z.object({
  DB_CLUSTER_ARN: z.string().min(1),
  DB_SECRET_ARN: z.string().min(1),
  DB_NAME: z.string().min(1),
  LAMBDA_TASK_ROOT: z.string().min(1)
})

export const applyMigrations = async (source: NodeJS.ProcessEnv = process.env): Promise<void> => {
  const config = readEnv(configSchema, source)
  const db = drizzle(new RDSDataClient({}), {
    resourceArn: config.DB_CLUSTER_ARN,
    secretArn: config.DB_SECRET_ARN,
    database: config.DB_NAME
  })

  await migrate(db, { migrationsFolder: `${config.LAMBDA_TASK_ROOT}/drizzle`, migrationsSchema: 'drizzle' })
}
