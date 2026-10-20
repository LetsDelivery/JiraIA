/**
 * Checks that every Lambda whose handler reads the service config is given the variables it needs.
 *
 * A sibling of `handlers-gate.ts`. In uselets it found four functions that would have died on their
 * first cold start. Every handler starts with
 * `buildService(readConfig())` at module load, and `readEnv` throws when a required variable is
 * absent — so a function missing one does not degrade, it fails to initialise, on every invocation,
 * in production and nowhere else. `tsc` does not read templates and `bun test` does not read
 * templates; a Lambda's environment is only ever checked by running it.
 *
 * Usage: bun run infra/ci/config-gate.ts
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { load } from './cfn.js'

const SERVICES = 'services'

/**
 * Variables the Lambda runtime sets by itself.
 *
 * A template that also set them would be refused by CloudFormation, so a config schema that asks
 * for one is satisfied without the template saying anything.
 */
const PROVIDED = new Set([
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_LAMBDA_FUNCTION_VERSION',
  'AWS_LAMBDA_LOG_GROUP_NAME',
  'AWS_LAMBDA_LOG_STREAM_NAME',
  'AWS_EXECUTION_ENV',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN'
])

type Problem = { service: string; fn: string; missing: string[] }

/** Every key in the config schema that has no `.optional()` and no `.default(`. */
const _requiredKeys = (source: string): string[] => {
  const body = source.slice(source.indexOf('z.object({'))

  return [...body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*(.+)$/gm)]
    .filter(([, , rest]) => !(rest as string).includes('.optional()') && !(rest as string).includes('.default('))
    .map(([, key]) => key as string)
    .filter((key) => !PROVIDED.has(key))
}

/** `consumers/x-consumer.onY` → `services/<svc>/src/consumers/x-consumer.ts` — first dot, as the runtime reads it. */
const _sourceOf = (service: string, handler: string): string =>
  join(SERVICES, service, 'src', `${handler.slice(0, handler.indexOf('.'))}.ts`)

/** What one function is missing, or nothing — including when it is not a config-reading function. */
const _missingFor = async (
  service: string,
  resource: {
    Type?: string
    Properties?: { Handler?: unknown; Environment?: { Variables?: Record<string, unknown> } }
  },
  globals: Record<string, unknown>,
  required: readonly string[]
): Promise<string[]> => {
  if (resource.Type !== 'AWS::Serverless::Function') {
    return []
  }

  const handler = resource.Properties?.Handler

  if (typeof handler !== 'string') {
    return []
  }

  const source = Bun.file(_sourceOf(service, handler))

  // Only handlers that actually read the config. A Cognito trigger that reads none of it needs none
  // of it, and demanding the whole set would make this gate noise instead of a signal.
  if (!(await source.exists()) || !(await source.text()).includes('readConfig(')) {
    return []
  }

  const variables = { ...globals, ...(resource.Properties?.Environment?.Variables ?? {}) }

  return required.filter((key) => !(key in variables))
}

const _check = async (service: string): Promise<Problem[]> => {
  const template = Bun.file(join(SERVICES, service, 'template.yml'))
  const config = Bun.file(join(SERVICES, service, 'src', 'config.ts'))

  if (!(await template.exists()) || !(await config.exists())) {
    return []
  }

  const required = _requiredKeys(await config.text())

  if (required.length === 0) {
    return []
  }

  const parsed = load(await template.text())
  const globals = parsed.Globals?.Function?.Environment?.Variables ?? {}
  const problems: Problem[] = []

  for (const [name, resource] of Object.entries(parsed.Resources ?? {})) {
    const missing = await _missingFor(service, resource, globals, required)

    if (missing.length > 0) {
      problems.push({ service, fn: name, missing })
    }
  }

  return problems
}

const services = (await readdir(SERVICES, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const problems = (await Promise.all(services.map(_check))).flat()

if (problems.length === 0) {
  console.error(`config: every config-reading Lambda in ${services.length} services has the variables it needs`)
  process.exit(0)
}

console.error(`${problems.length} function(s) would fail at cold start with a missing variable:\n`)

for (const problem of problems) {
  console.error(`  ${problem.service}: ${problem.fn}`)
  console.error(`    ${problem.missing.join(', ')} — required by services/${problem.service}/src/config.ts`)
}

console.error(
  '\nAdd them under the function, or make them optional in the schema if the function truly does not need them.'
)
process.exit(1)
