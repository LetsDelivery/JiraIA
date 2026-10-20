/**
 * Responses kept by key, so the sidebar and a screen asking for the same thing ask the API once.
 *
 * A write invalidates by prefix (`invalidate('space:')`) and tells the app, which re-renders what is on
 * screen. That is the whole data layer; nothing here retries or polls.
 */
const entries = new Map<string, Promise<unknown>>()
const listeners = new Set<() => void>()

export const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const existing = entries.get(key)
  if (existing) {
    return existing as Promise<T>
  }

  const loading = load().catch((error: unknown) => {
    entries.delete(key)
    throw error
  })
  entries.set(key, loading)
  return loading
}

/** Drops cached keys without telling anybody: the caller is about to load them again itself. */
export const forget = (...prefixes: string[]): void => {
  for (const key of [...entries.keys()]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      entries.delete(key)
    }
  }
}

export const invalidate = (...prefixes: string[]): void => {
  forget(...prefixes)
  for (const listener of listeners) {
    listener()
  }
}

export const clearCache = (): void => entries.clear()

export const onInvalidate = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
