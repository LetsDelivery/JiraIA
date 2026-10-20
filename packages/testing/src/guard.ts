import { TEST_DATABASE } from './config.js'

/**
 * Refuses to let the test suite touch anything but the local, disposable test database.
 *
 * The integration suite truncates tables. Pointed at a deployed database that is not a failing test,
 * it is data loss — so there is deliberately no variable that relaxes this (same stance as the
 * uselets guard, `packages/testing/src/guard.ts` there).
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** A refusal, as data, so every branch is testable in-process. */
export type Refusal = { title: string; details: readonly string[] }

/**
 * @example databaseRefusal('postgres://jiraia:jiraia@127.0.0.1:8210/jiraia_test')   // undefined
 */
export const databaseRefusal = (url: string | undefined): Refusal | undefined => {
  if (!url || !URL.canParse(url)) {
    return { title: 'the test database URL is missing or unparseable', details: [`DATABASE_URL=${url ?? '<unset>'}`] }
  }

  const parsed = new URL(url)
  const problems = [
    LOOPBACK_HOSTS.has(parsed.hostname) ? undefined : `host "${parsed.hostname}" is not loopback`,
    Number(parsed.port) === TEST_DATABASE.port ? undefined : `port ${parsed.port} is not ${TEST_DATABASE.port}`,
    parsed.pathname === `/${TEST_DATABASE.name}`
      ? undefined
      : `database "${parsed.pathname}" is not ${TEST_DATABASE.name}`
  ].filter((problem): problem is string => problem !== undefined)

  return problems.length === 0
    ? undefined
    : { title: 'the test suite is pointed at the wrong database', details: problems }
}

/** exit, not throw: a thrown error inside a preload can be reported as one failing test. */
export const abort = (refusal: Refusal): never => {
  const line = '='.repeat(72)
  console.error(`\n${line}\n  REFUSED: ${refusal.title}\n${line}`)
  for (const detail of refusal.details) {
    console.error(`  ${detail}`)
  }
  console.error(`${line}\n`)
  process.exit(1)
}
