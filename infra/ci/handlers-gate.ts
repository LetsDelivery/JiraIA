/**
 * Checks that every `Handler:` in `template.yml` points at a file the build actually emits.
 *
 * This exists because nothing else catches it. A Lambda handler is `<path/to/file>.<export>`, and
 * the Node runtime splits it on the **first** dot — `consumers/user.consumer.onUserReported` is read
 * as the module `consumers/user` and the export `consumer.onUserReported`, and dies with
 * `Cannot find module 'user'`. So a handler file cannot carry a dot in its name. In uselets the first
 * deploy shipped 35 functions the old spelling had broken, and a gate splitting on the last dot, as a
 * person would, passed every one of them. `tsc` does not read templates, `bun test` does not read
 * templates, and CloudFormation validates the string's shape and not its target: the first symptom
 * is `Cannot find module` on the first cold start after a deploy, in production.
 *
 * The same class of failure as the `zip -y` symlink in ADR-0010 — it passes every local check and
 * dies on the first invocation — and it gets the same treatment: a gate that reads the string the
 * way the runtime does.
 *
 * Usage: bun run infra/ci/handlers-gate.ts   (after `bun run build`)
 */

import { join } from 'node:path'

import { load, PACKAGE_SERVICE, TEMPLATE_PATH } from './cfn.js'

const APP_DIR = join('services', PACKAGE_SERVICE, 'app')

type Problem = { fn: string; handler: string; expected: string }

/**
 * The module the runtime will load: everything before the first dot, as `UserFunction.js` reads it.
 *
 * @example _fileFor('consumers/order-intake-consumer.onOrderReceived')   // 'consumers/order-intake-consumer.js'
 */
const _fileFor = (handler: string): string => `${handler.slice(0, handler.indexOf('.'))}.js`

/**
 * Whether the export half still has a dot in it — which means the file name had one, and the
 * runtime will look for a file that does not exist whatever the build emits.
 */
const _dottedModule = (handler: string): boolean => handler.slice(handler.indexOf('.') + 1).includes('.')

const _problemOf = async (fn: string, handler: unknown): Promise<Problem | undefined> => {
  const text = String(handler)
  const expected = _fileFor(text)
  if (!_dottedModule(text) && (await Bun.file(join(APP_DIR, expected)).exists())) {
    return undefined
  }
  return { fn, handler: text, expected }
}

const functions = Object.entries(load(await Bun.file(TEMPLATE_PATH).text()).Resources ?? {}).filter(
  ([, resource]) => resource.Type === 'AWS::Lambda::Function'
)
const problems = (
  await Promise.all(functions.map(([name, resource]) => _problemOf(name, resource.Properties?.Handler)))
).filter((problem) => problem !== undefined)

if (problems.length === 0) {
  // stderr, like every other gate here: stdout belongs to whatever is piping the build.
  console.error(
    `handlers: every Handler of ${functions.length} function(s) in ${TEMPLATE_PATH} resolves to an emitted file`
  )
  process.exit(0)
}

console.error(`${problems.length} handler(s) point at a file the build does not emit:\n`)

for (const problem of problems) {
  console.error(`  ${problem.fn}: Handler "${problem.handler}"`)
  console.error(`    the runtime will load ${APP_DIR}/${problem.expected}, which is not there`)
  console.error('    (a handler is split on its FIRST dot, so the file name may not contain one)')
}

console.error('\nRun `bun run build` first if app/ is stale.')
process.exit(1)
