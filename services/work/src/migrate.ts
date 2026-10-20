import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { readEnv } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'
import { drizzle } from 'drizzle-orm/aws-data-api/pg'
import { migrate } from 'drizzle-orm/aws-data-api/pg/migrator'
import { z } from 'zod'

/**
 * Applies this service's migrations to Aurora through the Data API (ADR-0002).
 *
 * Invoked by the deploy after the stack updates and before traffic depends on the new schema —
 * never on a request path. The migrations travel inside this function's package (`infra/build`), so
 * a deploy can only ever apply the migrations of the code it is shipping.
 */
const configSchema = z.object({
  DB_CLUSTER_ARN: z.string().min(1),
  DB_SECRET_ARN: z.string().min(1),
  DB_NAME: z.string().min(1),
  LAMBDA_TASK_ROOT: z.string().min(1)
})

const logger = createLogger('work', 'migrate')

export const handler = async (): Promise<{ applied: true }> => {
  const config = readEnv(configSchema, process.env)
  const db = drizzle(new RDSDataClient({}), {
    resourceArn: config.DB_CLUSTER_ARN,
    secretArn: config.DB_SECRET_ARN,
    database: config.DB_NAME
  })

  await migrate(db, { migrationsFolder: `${config.LAMBDA_TASK_ROOT}/drizzle`, migrationsSchema: 'drizzle' })
  logger.info('Migrations applied')

  return { applied: true }
}
