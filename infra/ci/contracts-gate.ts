import { buildDocument } from '../contracts/openapi.js'

/**
 * Every route says what it answers with, and the document on disk is the one the routes describe.
 *
 * Two failures, and they are different problems:
 *
 * - **a route with no `responds`** reaches a front end as `unknown`, which is the moment somebody
 *   goes back to reading this repository to find out what a screen should render. That is exactly
 *   what the contract exists to stop, and it is cheapest to refuse at the moment the route is
 *   written rather than a week later.
 * - **a stale `openapi.json`** is worse than none: a client generates types from it and believes
 *   them. The document is committed so a front end can build without this repository checked out,
 *   and a committed artefact that nothing verifies is a copy that drifts.
 *
 * Named the same way as the other gates, and it runs in `test:ci` beside them.
 */
const PATH = 'infra/contracts/openapi.json'

type Operation = { operationId?: string; responses?: Record<string, { content?: unknown }> }

/**
 * Whether one operation says what it answers with.
 *
 * No `content` at all is a route that answers nothing and said so with `z.void()`. An empty schema
 * is a route that said nothing at all — which is the case this gate exists to catch.
 */
const _declaresItsResponse = (operation: Operation): boolean => {
  const success = operation.responses?.['2XX'] as { content?: Record<string, { schema?: object }> } | undefined

  if (!success?.content) {
    return true
  }

  return Object.keys(success.content['application/json']?.schema ?? {}).length > 0
}

const _undeclared = (document: Record<string, unknown>): string[] => {
  const paths = (document.paths ?? {}) as Record<string, Record<string, Operation>>

  return Object.entries(paths)
    .flatMap(([path, operations]) =>
      Object.entries(operations)
        .filter(([, operation]) => !_declaresItsResponse(operation))
        .map(([method]) => `${method.toUpperCase()} ${path}`)
    )
    .sort()
}

const document = await buildDocument()
const serialised = `${JSON.stringify(document, null, 2)}\n`
const undeclared = _undeclared(document)

if (undeclared.length > 0) {
  console.error(`${undeclared.length} route(s) do not say what they answer with:\n`)

  for (const route of undeclared) {
    console.error(`  ${route}`)
  }

  console.error('\nAdd `responds:` to the route. A route that answers nothing declares `z.void()`.')
  process.exit(1)
}

const onDisk = await Bun.file(PATH)
  .text()
  .catch(() => '')

if (onDisk !== serialised) {
  console.error(`${PATH} is not what the routes describe.\n`)
  console.error('  Run `bun run contracts` and commit the result.')
  process.exit(1)
}

console.error(`contracts: ${Object.keys(document.paths as object).length} paths, every route declares its response`)
