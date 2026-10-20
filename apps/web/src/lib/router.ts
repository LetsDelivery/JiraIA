/**
 * Path → screen, on the History API. Links are ordinary `<a href="/…">`; a click on one is turned into
 * a navigation without a page load, so a link also works as a link (new tab, copy address).
 */
export type Params = Record<string, string>

export type RouteMatch<T> = { route: T; params: Params }

const _segments = (path: string): string[] => path.split('/').filter(Boolean)

/**
 * Matches `/espacos/:spaceId` against `/espacos/abc`. Literal segments must be equal; `:name` captures.
 *
 * @example matchPath('/espacos/:spaceId', '/espacos/42')   // { spaceId: '42' }
 */
export const matchPath = (pattern: string, path: string): Params | undefined => {
  const expected = _segments(pattern)
  const actual = _segments(path)
  if (expected.length !== actual.length) {
    return undefined
  }

  const params: Params = {}
  for (const [index, part] of expected.entries()) {
    const value = actual[index] ?? ''
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(value)
    } else if (part !== value) {
      return undefined
    }
  }
  return params
}

export const findRoute = <T extends { path: string }>(
  routes: readonly T[],
  path: string
): RouteMatch<T> | undefined => {
  for (const route of routes) {
    const params = matchPath(route.path, path)
    if (params) {
      return { route, params }
    }
  }
  return undefined
}

const listeners = new Set<() => void>()

export const navigate = (path: string, replace = false): void => {
  if (replace) {
    history.replaceState(null, '', path)
  } else {
    history.pushState(null, '', path)
  }
  for (const listener of listeners) {
    listener()
  }
}

export const onNavigate = (listener: () => void): void => {
  listeners.add(listener)
}

/** Same-origin links navigate in place; anything with a modifier key, a target or `download` does not. */
export const interceptLinks = (root: HTMLElement): void => {
  root.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a')
    const href = link?.getAttribute('href')
    const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0

    if (link && href?.startsWith('/') && plain && !link.target && !link.hasAttribute('download')) {
      event.preventDefault()
      navigate(href)
    }
  })
  window.addEventListener('popstate', () => {
    for (const listener of listeners) {
      listener()
    }
  })
}
