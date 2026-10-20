import type { HttpMethod, Route } from './route.js'

/** A path segment that is a `{name}` placeholder, or a literal. */
const PLACEHOLDER = /^\{(.+)\}$/

const _splitPath = (path: string): string[] => path.split('/').filter((segment) => segment.length > 0)

/**
 * Matches one request path against one route template, returning the captured params.
 *
 * There is no wildcard and no optional segment: a route matches a fixed number of
 * segments. Anything looser turns "route not found" into "some other route handled it",
 * which is the failure mode a fail-closed router exists to avoid.
 */
/**
 * Compares one segment. Returns the captured name and value, `'literal'` when the segment
 * matched a literal, or `undefined` when it did not match at all.
 */
const _matchSegment = (part: string, value: string): { name: string; value: string } | 'literal' | undefined => {
  const placeholder = PLACEHOLDER.exec(part)

  if (!placeholder?.[1]) {
    return part === value ? 'literal' : undefined
  }

  return { name: placeholder[1], value: decodeURIComponent(value) }
}

export const matchPath = (template: string, actual: string): Record<string, string> | undefined => {
  const templateParts = _splitPath(template)
  const actualParts = _splitPath(actual)

  if (templateParts.length !== actualParts.length) {
    return undefined
  }

  const params: Record<string, string> = {}

  for (const [index, part] of templateParts.entries()) {
    const value = actualParts[index]
    if (value === undefined) {
      return undefined
    }

    const matched = _matchSegment(part, value)
    if (!matched) {
      return undefined
    }
    if (matched !== 'literal') {
      params[matched.name] = matched.value
    }
  }

  return params
}

export type Matched = { route: Route; params: Record<string, string> }

/**
 * Finds the route for a method and path.
 *
 * Literal segments beat placeholders, so `/spaces/archived` wins over
 * `/spaces/{spaceId}` regardless of declaration order — otherwise adding a
 * literal route later would be silently shadowed by an existing placeholder one.
 */
export const matchRoute = (routes: readonly Route[], method: HttpMethod, path: string): Matched | undefined => {
  const candidates: Matched[] = []

  for (const route of routes) {
    if (route.method !== method) {
      continue
    }
    const params = matchPath(route.path, path)
    if (params) {
      candidates.push({ route, params })
    }
  }

  if (candidates.length === 0) {
    return undefined
  }

  return candidates.reduce((best, candidate) =>
    _placeholderCount(candidate.route.path) < _placeholderCount(best.route.path) ? candidate : best
  )
}

const _placeholderCount = (template: string): number =>
  _splitPath(template).filter((segment) => PLACEHOLDER.test(segment)).length
