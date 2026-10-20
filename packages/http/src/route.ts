import type { z } from 'zod'

import type { Caller } from './caller.js'

/**
 * What a caller must present to reach a route.
 *
 *   `public`          no token at all — sign-in, a health check
 *   `authenticated`   a verified token; the service then decides the role (ADR-0004)
 *
 * There is no grant here, unlike uselets: a JiraIA role depends on which space or project the
 * request is about, which only the service can read.
 */
export type Requirement = 'public' | 'authenticated'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * A route, with its input described by zod schemas rather than by types.
 *
 * The schemas are the only source of truth for both validation and typing. `path` and `query`
 * default to empty objects so a route that takes neither does not have to say so.
 */
export type Route<
  TBody extends z.ZodType = z.ZodType,
  TPath extends z.ZodType = z.ZodType,
  TQuery extends z.ZodType = z.ZodType
> = {
  method: HttpMethod
  /** Template with `{name}` placeholders, e.g. `/spaces/{spaceId}`. */
  path: string
  requires: Requirement
  /** Whether an OAuth token — an application acting as a person (ADR-0022) — may call it. Only MCP does. */
  delegated?: true
  schemas: { body?: TBody; path?: TPath; query?: TQuery }
  /**
   * What a 2xx answers with. It is what `bun run contracts` turns into the OpenAPI document the web
   * app generates its types from, and what the router checks the handler against wherever
   * `VALIDATE_RESPONSES=1`.
   */
  responds?: z.ZodType
  handler: (input: {
    body: TBody extends z.ZodType ? z.infer<TBody> : undefined
    path: TPath extends z.ZodType ? z.infer<TPath> : undefined
    query: TQuery extends z.ZodType ? z.infer<TQuery> : undefined
    caller: Caller
    traceId: string
    /** The request's headers, names lowercased — for the few routes a protocol makes read one (MCP). */
    headers: Readonly<Record<string, string | undefined>>
  }) => Promise<{ statusCode: number; body?: unknown; headers?: Record<string, string> }>
}

/**
 * Declares a route and preserves the inference from its schemas.
 *
 * `requires` has no default on purpose: the router fails closed, and a default would make
 * forgetting it indistinguishable from choosing it.
 *
 * @example
 * defineRoute({
 *   method: 'GET',
 *   path: '/spaces/{spaceId}',
 *   requires: 'authenticated',
 *   schemas: { path: z.object({ spaceId: z.uuid() }) },
 *   handler: async ({ path, caller }) => ({ statusCode: 200, body: await spaces.read(caller, path.spaceId) })
 * })
 */
export const defineRoute = <TBody extends z.ZodType, TPath extends z.ZodType, TQuery extends z.ZodType>(
  route: Route<TBody, TPath, TQuery>
): Route<TBody, TPath, TQuery> => route
