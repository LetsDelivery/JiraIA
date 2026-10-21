/**
 * Checks that every Lambda in `template.yml` whose handler reads the service config is given the
 * variables it needs.
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

import { join } from 'node:path'

import { load, PACKAGE_SERVICE, TEMPLATE_PATH } from './cfn.js'
import { requiredKeys } from './config-keys.js'

type Problem = { fn: string; missing: string[] }

/** `index.handler` → `services/work/src/index.ts` — first dot, as the runtime reads it. */
const _sourceOf = (handler: string): string =>
  join('services', PACKAGE_SERVICE, 'src', `${handler.slice(0, handler.indexOf('.'))}.ts`)

/** What one function is missing, or nothing — including when it is not a config-reading function. */
const _missingFor = async (
  resource: {
    Type?: string
    Properties?: { Handler?: unknown; Environment?: { Variables?: Record<string, unknown> } }
  },
  required: readonly string[]
): Promise<string[]> => {
  const handler = resource.Properties?.Handler
  if (resource.Type !== 'AWS::Lambda::Function' || typeof handler !== 'string') {
    return []
  }

  const source = Bun.file(_sourceOf(handler))

  // Only handlers that actually read the config: one that reads none of it needs none of it.
  if (!(await source.exists()) || !(await source.text()).includes('readConfig(')) {
    return []
  }

  const variables = resource.Properties?.Environment?.Variables ?? {}

  return required.filter((key) => !(key in variables))
}

const required = requiredKeys(await Bun.file(join('services', PACKAGE_SERVICE, 'src', 'config.ts')).text())
const resources = Object.entries(load(await Bun.file(TEMPLATE_PATH).text()).Resources ?? {})
const problems: Problem[] = []

for (const [fn, resource] of resources) {
  const missing = await _missingFor(resource, required)
  if (missing.length > 0) {
    problems.push({ fn, missing })
  }
}

if (problems.length === 0) {
  console.error(`config: every config-reading Lambda in ${TEMPLATE_PATH} has the variables it needs`)
  process.exit(0)
}

console.error(`${problems.length} function(s) would fail at cold start with a missing variable:\n`)

for (const problem of problems) {
  console.error(`  ${problem.fn}`)
  console.error(`    ${problem.missing.join(', ')} — required by services/${PACKAGE_SERVICE}/src/config.ts`)
}

console.error(
  '\nAdd them under the function, or make them optional in the schema if the function truly does not need them.'
)
process.exit(1)
