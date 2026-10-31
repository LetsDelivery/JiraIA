import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { Route } from '@jiraia/http'
import { z } from 'zod'

/**
 * Turns the routes into an OpenAPI 3.1 document.
 *
 *     bun run contracts            # writes infra/contracts/openapi.json
 *     bun run contracts --out=…    # somewhere else, e.g. a front end's repo
 *
 * The point is not documentation, it is **that nobody has to read this repository to call it**. A
 * front end runs `openapi-typescript` over the output and gets every path, every parameter and every
 * response body as types — so a renamed field is a red squiggle in the client rather than an
 * `undefined` on a screen.
 *
 * It is generated rather than written because it already exists: `defineRoute` declares the method,
 * the path, what the caller must hold and the zod schema of every input, and Zod 4 turns a schema
 * into JSON Schema itself (`z.toJSONSchema`). Writing the document by hand would be a second copy of
 * all of that, and the copy is always the one that is wrong.
 *
 * **Routes are read without building anything.** Each service exports a factory —
 * `workRoutes(services)` — that only closes over its services; nothing is called
 * until a request arrives. So the factories are handed a `Proxy` and the array comes back complete,
 * with no database, no credentials and no environment.
 */
const SERVICES = [
  {
    name: 'work',
    prefix: '/work',
    modules: [
      'routes.js',
      'cards/routes.js',
      'cards/card-type.routes.js',
      'labels/routes.js',
      'cards/relation.routes.js',
      'cards/conversation.routes.js',
      'cards/detail.routes.js',
      'personal/my-cards.routes.js',
      'sprints/routes.js',
      'search/routes.js',
      'views/routes.js',
      'reports/routes.js',
      'slack/routes.js',
      'github/routes.js',
      'groups/routes.js',
      'grants/routes.js',
      'requests/routes.js',
      'governance/routes.js',
      'draw/routes.js',
      'draw/space.routes.js',
      'wiki/routes.js',
      'forms/routes.js',
      'automations/routes.js',
      'integrations/routes.js',
      'notifications/routes.js',
      'tokens/routes.js',
      'webhooks/routes.js',
      'proposals/routes.js',
      'mcp/routes.js',
      'oauth/routes.js'
    ]
  }
] as const

/** Stands in for whatever a route factory wants. Nothing on it is ever called at declaration time. */
const _stub = (): unknown => new Proxy(() => undefined, { get: () => _stub(), apply: () => _stub() })

type Json = Record<string, unknown>

/**
 * A zod schema as JSON Schema, or nothing.
 *
 * `io: 'input'` for what a caller sends, because a query schema with a `.transform()` describes two
 * shapes and the caller only ever writes the first. `unrepresentable: 'any'` rather than throwing:
 * one field zod cannot express in JSON Schema must not cost the whole document.
 */
const _json = (schema: z.ZodType | undefined, io: 'input' | 'output'): Json | undefined => {
  if (!schema) {
    return undefined
  }

  try {
    const { $schema: _dropped, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Json

    return _hoisted(rest)
  } catch {
    return { type: 'object' }
  }
}

/**
 * The schemas that carry a `.meta({ id })`, collected while the routes render and written once under
 * `components.schemas`.
 *
 * `z.toJSONSchema` renders one route at a time, so a named schema lands in each route's own `$defs`
 * — in uselets one schema became eighteen copies of the same union. Hoisting them makes it
 * one component every route refers to, and gives the panel a name to read it by. Reset per document.
 */
let SHARED: Record<string, Json> = {}

const _hoisted = (rendered: Json): Json => {
  const { $defs, ...rest } = rendered as Json & { $defs?: Record<string, Json> }

  Object.assign(SHARED, _pointedAtComponents($defs ?? {}))

  return _pointedAtComponents(rest)
}

const _pointedAtComponents = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replaceAll('"#/$defs/', '"#/components/schemas/')) as T

/** `{spaceId}` in a path template is a required path parameter, whatever the schema says. */
const _pathParameters = (path: string, schema: z.ZodType | undefined): Json[] => {
  const shape = (_json(schema, 'input')?.properties ?? {}) as Record<string, Json>

  return [...path.matchAll(/\{(\w+)}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: shape[match[1] ?? ''] ?? { type: 'string' }
  }))
}

/**
 * Query parameters, flattened.
 *
 * Every one is a string on the wire — `?status=A,B` is one value, not an array — so the schema's own
 * type is kept only when it is already a string. Anything else is what the route's `.transform()`
 * turns it into, and the caller still writes text.
 */
const _queryParameters = (schema: z.ZodType | undefined): Json[] => {
  const document = _json(schema, 'input')
  const properties = (document?.properties ?? {}) as Record<string, Json>
  const required = new Set((document?.required ?? []) as string[])

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: property.type === 'string' ? property : { type: 'string' },
    ...(property.description ? { description: property.description } : {})
  }))
}

const _operationId = (service: string, method: string, path: string): string =>
  `${service}${method[0]}${method.slice(1).toLowerCase()}${path.replace(/[{}]/g, '').replace(/[/-](\w)/g, (_, c) => c.toUpperCase())}`

/**
 * One route as an OpenAPI operation.
 *
 * `requires` becomes both the security requirement and a line of the description. Which role a
 * route needs inside a space or project is decided by the service (ADR-0004) and answered as a 403
 * naming the action.
 */
const _operation = (service: string, route: Route): Json => {
  const body = _json(route.schemas.body, 'input')

  return {
    operationId: _operationId(service, route.method, route.path),
    tags: [service],
    summary: `${route.method} ${route.path}`,
    description: `Requires \`${route.requires}\`.`,
    ...(route.requires === 'public' ? { security: [] } : {}),
    parameters: [..._pathParameters(route.path, route.schemas.path), ..._queryParameters(route.schemas.query)],
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
    responses: _responses(route)
  }
}

/**
 * The two answers every operation has: what it returns, and the envelope it refuses with.
 *
 * Keyed `2XX` rather than `200`, and that is not cosmetic. Handlers answer 200, 201 and 204;
 * declaring only `200` would type a client's `data` off a status the server never sends.
 *
 * `'2XX'`, `'4XX'` and `$ref` are OpenAPI's own spellings, not this repository's — which is why
 * `biome.json` turns the naming rule off for this directory, exactly as it does for the protocol
 * stubs in `infra/local`. Renaming them to satisfy a lint rule would produce a document no OpenAPI
 * tool can read.
 */
const _responses = (route: Route): Json => {
  const refused = {
    description: 'refused',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  }

  // A route that answers nothing says so by declaring `z.void()`. No `content` at all is what makes
  // a generated client type `data` as absent rather than as an empty object it might try to read.
  if (route.responds instanceof z.ZodVoid) {
    return { ['2XX']: { description: 'done, with no body' }, ['4XX']: refused }
  }

  const responds = _json(route.responds, 'output')

  return {
    ['2XX']: { description: 'ok', content: { 'application/json': { schema: responds ?? {} } } },
    ['4XX']: refused
  }
}

/**
 * The platform's error envelope, which every route can answer with.
 *
 * Declared once here rather than on each route: it is the router's shape, not any handler's, and a
 * client that can read one can read all of them.
 */
const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'traceId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
        traceId: { type: 'string' }
      }
    }
  }
} as const

/**
 * Every route a service declares, whichever module declares it.
 *
 * The factory is found by shape rather than by name — anything exported that is a function whose
 * call returns an array of things with a `method`, a `path` and a `requires`. `security` splits its
 * routes over four modules and `integration` over three; hunting for a naming convention that holds
 * across all of them would be a convention to maintain rather than a fact to read.
 */
/** Calls one export and keeps the result only if it really is an array of routes. */
const _routesFrom = (exported: unknown): Route[] => {
  if (typeof exported !== 'function') {
    return []
  }

  // Eight stubs is more arguments than any factory takes; the extra ones are ignored.
  const stubs = Array.from({ length: 8 }, () => _stub())
  const routes = (exported as (...args: unknown[]) => unknown)(...stubs)

  return Array.isArray(routes) && routes.every(_isRoute) ? (routes as Route[]) : []
}

const _load = async (service: (typeof SERVICES)[number]): Promise<Route[]> => {
  const found: Route[] = []

  for (const module of service.modules) {
    const loaded = (await import(`../../services/${service.name}/src/${module}`)) as Record<string, unknown>

    found.push(...Object.values(loaded).flatMap(_routesFrom))
  }

  if (found.length === 0) {
    throw new Error(`services/${service.name} declared no routes; the contract cannot be read`)
  }

  return found
}

const _isRoute = (candidate: unknown): boolean =>
  typeof candidate === 'object' &&
  candidate !== null &&
  'method' in candidate &&
  'path' in candidate &&
  'requires' in candidate

/** Every route of every service, as OpenAPI paths, keeping only what this audience can reach. */
const _pathsFor = async (): Promise<{ paths: Record<string, Json>; counted: number; described: number }> => {
  const paths: Record<string, Json> = {}
  let counted = 0
  let described = 0

  for (const service of SERVICES) {
    for (const route of await _load(service)) {
      const path = `${service.prefix}${route.path}`
      const existing = (paths[path] ?? {}) as Json

      paths[path] = { ...existing, [route.method.toLowerCase()]: _operation(service.name, route) }
      counted += 1
      described += route.responds ? 1 : 0
    }
  }

  return { paths, counted, described }
}

export const buildDocument = async (): Promise<Json> => {
  SHARED = {}
  const { paths, counted, described } = await _pathsFor()

  console.error(`  ${counted} routes, ${described} with a declared response body`)

  return {
    openapi: '3.1.0',
    info: {
      title: 'JiraIA',
      version: '1.0.0',
      description: 'Generated from the route definitions. Do not edit: run `bun run contracts`.'
    },
    servers: [{ url: 'http://localhost:8280', description: 'local' }],
    components: {
      schemas: { Error: ERROR_SCHEMA, ...SHARED },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
    },
    security: [{ bearer: [] }],
    tags: SERVICES.map((service) => ({ name: service.name })),
    paths
  }
}

const _out = (): string => {
  const named = process.argv.find((argument) => argument.startsWith('--out='))?.slice('--out='.length)

  return resolve(named ?? 'infra/contracts/openapi.json')
}

if (import.meta.main) {
  const target = _out()

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(await buildDocument(), null, 2)}\n`)
  console.error(`  contracts: ${target}`)
}
