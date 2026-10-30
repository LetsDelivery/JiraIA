import { describe, expect, it } from 'vitest'

import { hidesOldDone, oldDoneHref, showsAllDone } from './old-done'

describe('hidesOldDone', () => {
  it('hides them by default, also under a filter that names no state', () => {
    expect(hidesOldDone({}, '')).toBe(true)
    expect(hidesOldDone({ assignees: ['me'] }, '?aba=lista')).toBe(true)
  })

  it('shows them all when asked, or when the filter names states', () => {
    expect(hidesOldDone({}, '?aba=lista&concluidos=todos')).toBe(false)
    expect(hidesOldDone({ stateGroups: ['done'] }, '')).toBe(false)
    expect(hidesOldDone({ stateIds: ['3f1c0d5e-0000-4000-8000-000000000000'] }, '')).toBe(false)
  })
})

describe('oldDoneHref', () => {
  it('adds and takes off the request for every done card, keeping the rest of the address', () => {
    const all = oldDoneHref('/espacos/TEC?aba=lista', true)
    expect(all).toBe('/espacos/TEC?aba=lista&concluidos=todos')
    expect(showsAllDone(all.slice(all.indexOf('?')))).toBe(true)
    expect(oldDoneHref(all, false)).toBe('/espacos/TEC?aba=lista')
  })
})
