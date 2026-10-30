import { initials } from '@/lib/cards'
import { type Html, html } from '@/lib/html'

/**
 * A person as a small circle (ADR-0039): their photo when they put one on their profile, their
 * initials otherwise — and underneath the photo, so a photo that fails to load leaves the initials.
 */
export type Person = { id?: string | null; name: string }

/** Each member's photo by id, learnt from every list of members the panel reads. */
const faces = new Map<string, string>()

export const learnFaces = (people: readonly { id: string; avatarUrl: string | null }[]): void => {
  for (const person of people) {
    if (person.avatarUrl) {
      faces.set(person.id, person.avatarUrl)
    } else {
      faces.delete(person.id)
    }
  }
}

export const faceOf = (person: Person): string | undefined => (person.id ? faces.get(person.id) : undefined)

export const avatar = (person: Person, className = 'avatar'): Html => {
  const face = faceOf(person)
  return html`<span class="${className}" title="${person.name}">${initials(person.name) || '?'}${face ? html`<img class="avatar-photo" src="${face}" alt="" loading="lazy" decoding="async" />` : ''}</span>`
}

/** A signed photo URL expires after hours; at most this often a failed one asks for fresh URLs. */
export const REFRESH_AFTER_MS = 10 * 60_000

/**
 * A photo that fails to load is taken off, showing the initials, and the members are read again
 * (`refresh`) for fresh URLs — once in a while, so a photo that is truly gone does not loop.
 */
export const bindAvatarFallback = (root: Document, refresh: () => void, now: () => number = Date.now): void => {
  let lastRefresh = Number.NEGATIVE_INFINITY
  root.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null
      if (!target?.classList?.contains('avatar-photo')) {
        return
      }
      target.remove()
      if (now() - lastRefresh >= REFRESH_AFTER_MS) {
        lastRefresh = now()
        refresh()
      }
    },
    true
  )
}
