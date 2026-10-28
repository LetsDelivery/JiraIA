import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { readEnv } from '@jiraia/core'
import { type ResumePolicy, resumeAware } from '@jiraia/db'
import { drizzle } from 'drizzle-orm/aws-data-api/pg'
import { migrate } from 'drizzle-orm/aws-data-api/pg/migrator'
import { z } from 'zod'

/**
 * Applies this service's migrations to Aurora through the Data API (ADR-0002).
 *
 * Run by the deploy — the stack's `Deploy` custom resource (ADR-0025) — never on a request path. The
 * migrations travel inside the function's package (`infra/build`), so a deploy can only ever apply
 * the migrations of the code it is shipping.
 *
 * A deploy may find the cluster paused (ADR-0035): its first statement wakes it, and the Data API
 * answers "resuming" until it is up, some fifteen to thirty seconds later. The migrations wait for it
 * rather than fail the deploy.
 */
const configSchema = z.object({
  DB_CLUSTER_ARN: z.string().min(1),
  DB_SECRET_ARN: z.string().min(1),
  DB_NAME: z.string().min(1),
  LAMBDA_TASK_ROOT: z.string().min(1)
})

/** Well past a resume, and well inside the function's five minutes. */
export const MIGRATION_RESUME: ResumePolicy = { waitMs: () => 120_000 }

/**
 * The Data API client the migrations send through: it sends a statement again while the cluster resumes.
 *
 * @example migrationClient(new RDSDataClient({}))
 */
export const migrationClient = (client: RDSDataClient, policy: ResumePolicy = MIGRATION_RESUME): RDSDataClient =>
  resumeAware(client, policy)

export const applyMigrations = async (source: NodeJS.ProcessEnv = process.env): Promise<void> => {
  const config = readEnv(configSchema, source)
  const db = drizzle(migrationClient(new RDSDataClient({})), {
    resourceArn: config.DB_CLUSTER_ARN,
    secretArn: config.DB_SECRET_ARN,
    database: config.DB_NAME
  })

  await migrate(db, { migrationsFolder: `${config.LAMBDA_TASK_ROOT}/drizzle`, migrationsSchema: 'drizzle' })
}
