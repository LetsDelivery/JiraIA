import { connectDatabase } from '@jiraia/db'
import { createLogger } from '@jiraia/logger'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { assertDevDatabase, DEV_DATABASE_URL, MIGRATION_FOLDERS } from './config.js'

/**
 * Applies every service's migrations to the dev database.
 *
 *     bun run db:migrate
 */
const logger = createLogger('local', 'migrate')
const url = process.env.DATABASE_URL ?? DEV_DATABASE_URL
assertDevDatabase(url)

const db = connectDatabase({ DATABASE_URL: url })

for (const migrationsFolder of MIGRATION_FOLDERS) {
  await migrate(db as never, { migrationsFolder, migrationsSchema: 'drizzle' })
  logger.info('Migrations applied', { migrationsFolder })
}

process.exit(0)
