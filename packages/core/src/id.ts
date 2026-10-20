import { randomUUID } from 'node:crypto'

/**
 * Identifier generation, behind a port so tests can make ids deterministic.
 *
 * Every id in the platform is a UUID v4 rendered lowercase without braces. There is
 * deliberately no prefixed or human-readable id scheme: prefixes belong to the
 * DynamoDB key (`ORDER#<id>`), not to the value, so that the same id can be carried
 * in an event payload without a consumer having to strip anything.
 */
export type IdGenerator = { next: () => string }

export const uuidGenerator: IdGenerator = { next: () => randomUUID() }

/** A generator that walks a fixed list, then throws. For tests only. */
export const fixedIdGenerator = (ids: readonly string[]): IdGenerator => {
  let index = 0

  return {
    next: () => {
      const id = ids[index]
      if (id === undefined) {
        throw new Error(`fixedIdGenerator exhausted: asked for id ${index + 1} of ${ids.length}`)
      }
      index += 1
      return id
    }
  }
}
