import { connectDatabase, type Database } from '@jiraia/db'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { TEST_DATABASE_URL } from './config.js'
import { abort, databaseRefusal } from './guard.js'

let shared: Database | undefined

/**
 * The test database with one service's migrations applied, connected once per process.
 *
 * @example const db = await testDatabase('services/work/drizzle')
 */
export const testDatabase = async (migrationsFolder: string): Promise<Database> => {
  const refusal = databaseRefusal(TEST_DATABASE_URL)
  if (refusal) {
    abort(refusal)
  }

  shared ??= connectDatabase({ DATABASE_URL: TEST_DATABASE_URL })
  await migrate(shared as never, { migrationsFolder, migrationsSchema: 'drizzle' })

  return shared
}

/**
 * Empties every table of one schema, so each test starts from nothing.
 *
 * Re-checks the guard first: this is the one destructive statement the suite issues.
 */
export const truncateSchema = async (db: Database, schema: string): Promise<void> => {
  const refusal = databaseRefusal(process.env.DATABASE_URL)
  if (refusal) {
    abort(refusal)
  }

  // The test database is always the `pg` driver, whose result carries `rows`.
  const result = (await db.execute(sql`select tablename from pg_tables where schemaname = ${schema}`)) as unknown as {
    rows: { tablename: string }[]
  }
  const tables = result.rows.map((row) => `"${schema}"."${row.tablename}"`)

  if (tables.length > 0) {
    await db.execute(sql.raw(`truncate ${tables.join(', ')} cascade`))
  }
}
