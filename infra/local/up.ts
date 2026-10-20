import { spawn } from 'bun'

/**
 * Everything, from nothing, in one command:
 *
 *     bun run up
 *
 * containers → migrations → seed (when empty) → the API on :8280 and the panel on :5173.
 */
const run = async (label: string, command: string[]): Promise<void> => {
  const child = spawn(command, { stdout: 'inherit', stderr: 'inherit' })
  if ((await child.exited) !== 0) {
    console.error(`\n  up: ${label} failed (${command.join(' ')})\n`)
    process.exit(1)
  }
}

await run('containers', ['docker', 'compose', 'up', '-d', '--wait'])
await run('migrations', ['bun', 'run', 'infra/local/migrate.ts'])
await run('seed', ['bun', 'run', 'infra/local/seed.ts'])

const api = spawn(['bun', 'run', 'infra/local/server.ts'], { stdout: 'inherit', stderr: 'inherit' })
const web = spawn(['bun', 'run', '--filter', '@jiraia/web', 'dev'], { stdout: 'inherit', stderr: 'inherit' })

process.on('SIGINT', () => {
  api.kill()
  web.kill()
  process.exit(0)
})

await Promise.race([api.exited, web.exited])
