import { connectDatabase } from '@jiraia/db'
import { spawn } from 'bun'
import { sql } from 'drizzle-orm'

import { E2E_DATABASE, E2E_DATABASE_URL } from './config.js'

/**
 * The end-to-end suite's own API: a clean database, migrated and seeded, then `local:serve` on :8290.
 * Started by `apps/web/playwright.config.ts`, so a run never touches the dev database you work in.
 *
 *     bun run infra/local/e2e.ts
 */
const E2E_API_PORT = '8290'
const env = {
  ...process.env,
  DATABASE_URL: E2E_DATABASE_URL,
  LOCAL_PORT: E2E_API_PORT,
  LOCAL_WEB_URL: 'http://localhost:5290'
}

const run = async (label: string, command: string[]): Promise<void> => {
  const child = spawn(command, { env, stdout: 'inherit', stderr: 'inherit' })
  if ((await child.exited) !== 0) {
    console.error(`\n  e2e: ${label} failed\n`)
    process.exit(1)
  }
}

if (new URL(E2E_DATABASE_URL).port !== String(E2E_DATABASE.port)) {
  console.error('  REFUSED: e2e only ever wipes the postgres-e2e container')
  process.exit(1)
}

await run('container', ['docker', 'compose', 'up', '-d', '--wait', 'postgres-e2e'])

const db = connectDatabase({ DATABASE_URL: E2E_DATABASE_URL })
await db.execute(sql.raw('drop schema if exists work cascade; drop schema if exists drizzle cascade'))

await run('migrations', ['bun', 'run', 'infra/local/migrate.ts'])
await run('seed', ['bun', 'run', 'infra/local/seed.ts'])

const server = spawn(['bun', 'run', 'infra/local/server.ts'], { env, stdout: 'inherit', stderr: 'inherit' })
process.on('SIGTERM', () => server.kill())
process.on('SIGINT', () => server.kill())
await server.exited
