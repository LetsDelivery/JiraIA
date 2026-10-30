import { describe, expect, it, vi } from 'vitest'

import { avatar, bindAvatarFallback, faceOf, learnFaces, REFRESH_AFTER_MS } from './avatar'

describe('avatar', () => {
  it('draws the initials of a person with no photo', () => {
    expect(avatar({ id: 'p1', name: 'Ana Souza' }).value).toBe('<span class="avatar" title="Ana Souza">AS</span>')
  })

  it('lays the learnt photo over the initials, and forgets it once removed', () => {
    learnFaces([{ id: 'p2', avatarUrl: 'https://files.test/p2.webp?a=1&b=2' }])
    expect(avatar({ id: 'p2', name: 'Rui' }, 'account-avatar').value).toBe(
      '<span class="account-avatar" title="Rui">R<img class="avatar-photo" src="https://files.test/p2.webp?a=1&amp;b=2" alt="" loading="lazy" decoding="async" /></span>'
    )
    learnFaces([{ id: 'p2', avatarUrl: null }])
    expect(faceOf({ id: 'p2', name: 'Rui' })).toBeUndefined()
  })

  it('shows no photo for a person named without an id', () => {
    learnFaces([{ id: 'p3', avatarUrl: 'https://files.test/p3.webp' }])
    expect(faceOf({ name: 'Lia' })).toBeUndefined()
  })
})

describe('bindAvatarFallback', () => {
  const failing = () => {
    let listener: (event: Event) => void = () => undefined
    const root = { addEventListener: (_: string, handler: (event: Event) => void) => (listener = handler) }
    const photo = { classList: { contains: (name: string) => name === 'avatar-photo' }, remove: vi.fn() }
    return { root: root as unknown as Document, photo, fail: () => listener({ target: photo } as unknown as Event) }
  }

  it('takes the broken photo off and asks for fresh URLs at most once in a while', () => {
    const { root, photo, fail } = failing()
    const refresh = vi.fn()
    let now = 0
    bindAvatarFallback(root, refresh, () => now)

    fail()
    fail()
    now = REFRESH_AFTER_MS
    fail()
    expect(photo.remove).toHaveBeenCalledTimes(3)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
