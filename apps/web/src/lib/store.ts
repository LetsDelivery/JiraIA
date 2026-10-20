/** A value and the functions to call when it changes. The whole of this app's state management. */
export type Store<T> = {
  get: () => T
  set: (value: T) => void
  subscribe: (listener: (value: T) => void) => () => void
}

export const createStore = <T>(initial: T): Store<T> => {
  let value = initial
  const listeners = new Set<(value: T) => void>()

  return {
    get: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) {
        listener(value)
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** A store mirrored to `localStorage`. Unreadable or absent storage starts from `initial`. */
export const persistedStore = <T>(key: string, initial: T): Store<T> => {
  const read = (): T => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? (JSON.parse(stored) as T) : initial
    } catch {
      return initial
    }
  }
  const store = createStore<T>(read())

  store.subscribe((value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Private mode or a full disk: the session lives for this tab only.
    }
  })
  return store
}
