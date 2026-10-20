import { describe, expect, it } from 'vitest'

import { findRoute, matchPath } from './router'

describe('matchPath', () => {
  it('captures a parameter', () => {
    expect(matchPath('/espacos/:spaceId', '/espacos/42')).toEqual({ spaceId: '42' })
  })

  it('needs every literal segment to be equal', () => {
    expect(matchPath('/espacos/:spaceId', '/pessoas/42')).toBeUndefined()
  })

  it('needs the same number of segments', () => {
    expect(matchPath('/espacos', '/espacos/42')).toBeUndefined()
  })

  it('treats a trailing slash as the same path', () => {
    expect(matchPath('/espacos', '/espacos/')).toEqual({})
  })
})

describe('findRoute', () => {
  it('answers the first route that matches', () => {
    const routes = [{ path: '/' }, { path: '/espacos' }, { path: '/espacos/:spaceId' }]

    expect(findRoute(routes, '/espacos/7')).toEqual({ route: { path: '/espacos/:spaceId' }, params: { spaceId: '7' } })
  })
})
