/**
 * Checks that every `Handler:` in every service template points at a file the build actually emits.
 *
 * This exists because nothing else catches it. A Lambda handler is `<path/to/file>.<export>`, and
 * the Node runtime splits it on the **first** dot — `consumers/user.consumer.onUserReported` is read
 * as the module `consumers/user` and the export `consumer.onUserReported`, and dies with
 * `Cannot find module 'user'`. So a handler file cannot carry a dot in its name, which is why the
 * consumers are `x-consumer.ts` and not `x.consumer.ts`: the first deploy shipped 35 functions the
 * old spelling had broken, and this gate — splitting on the last dot, as a person would — passed
 * every one of them. `tsc` does not read templates, `bun test` does not read templates, and
 * CloudFormation validates the string's shape and not its target: the first symptom is
 * `Cannot find module` on the first cold start after a deploy, in production, per function.
 *
 * The same class of failure as the `zip -y` symlink in ADR-0010 — it passes every local check and
 * dies on the first invocation — and it gets the same treatment: a gate that reads the string the
 * way the runtime does.
 *
 * Usage: bun run infra/ci/handlers-gate.ts
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SERVICES = 'services'

type Problem = { service: string; handler: string; expected: string }

/** Every `Handler: <value>` in a template, in the order they appear. */
const _handlersIn = (template: string): string[] =>
  [...template.matchAll(/^\s*Handler:\s*(\S+)\s*$/gm)].map((match) => match[1] as string)

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

const _check = async (service: string): Promise<Problem[]> => {
  const template = Bun.file(join(SERVICES, service, 'template.yml'))

  if (!(await template.exists())) {
    return []
  }

  const problems: Problem[] = []

  for (const handler of _handlersIn(await template.text())) {
    const expected = _fileFor(handler)

    if (!_dottedModule(handler) && (await Bun.file(join(SERVICES, service, 'app', expected)).exists())) {
      continue
    }

    problems.push({ service, handler, expected })
  }

  return problems
}

const services = (await readdir(SERVICES, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const problems = (await Promise.all(services.map(_check))).flat()

if (problems.length === 0) {
  // stderr, like every other gate here: stdout belongs to whatever is piping the build.
  console.error(`handlers: every Handler in ${services.length} templates resolves to an emitted file`)
  process.exit(0)
}

console.error(`${problems.length} handler(s) point at a file the build does not emit:\n`)

for (const problem of problems) {
  console.error(`  ${problem.service}: Handler "${problem.handler}"`)
  console.error(`    the runtime will load services/${problem.service}/app/${problem.expected}, which is not there`)
  console.error('    (a handler is split on its FIRST dot, so the file name may not contain one)')
}

console.error('\nA Lambda handler splits on its LAST dot. Run `bun run build` first if app/ is stale.')
process.exit(1)
