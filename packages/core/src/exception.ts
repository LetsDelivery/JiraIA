/**
 * The exception hierarchy every service throws and the HTTP layer translates.
 *
 * Two rules the project's style guide imposes, both enforced by the constructors
 * below rather than by review:
 *
 * 1. A message names the offending value and the expected shape. `details` exists so
 *    that naming it does not require string concatenation at every throw site.
 * 2. Nothing in `details` is secret. These objects are serialised into the HTTP
 *    response, so a credential or a token must never be put there.
 */

/** Machine-readable code. Clients switch on this, never on the message. */
export type FailureCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL'

export type FailureDetails = Record<string, unknown>

export class JiraiaException extends Error {
  readonly code: FailureCode
  readonly status: number
  readonly details: FailureDetails

  constructor(params: { code: FailureCode; status: number; message: string; details?: FailureDetails | undefined }) {
    super(params.message)
    this.name = new.target.name
    this.code = params.code
    this.status = params.status
    this.details = params.details ?? {}
  }
}

export class ValidationException extends JiraiaException {
  constructor(message: string, details?: FailureDetails | undefined) {
    super({ code: 'VALIDATION_FAILED', status: 400, message, details })
  }
}

export class UnauthenticatedException extends JiraiaException {
  constructor(message = 'No valid credential was presented', details?: FailureDetails | undefined) {
    super({ code: 'UNAUTHENTICATED', status: 401, message, details })
  }
}

export class ForbiddenException extends JiraiaException {
  constructor(message: string, details?: FailureDetails | undefined) {
    super({ code: 'FORBIDDEN', status: 403, message, details })
  }
}

export class NotFoundException extends JiraiaException {
  constructor(resource: string, id: string) {
    super({
      code: 'NOT_FOUND',
      status: 404,
      message: `${resource} "${id}" does not exist`,
      details: { resource, id }
    })
  }
}

export class ConflictException extends JiraiaException {
  constructor(message: string, details?: FailureDetails | undefined) {
    super({ code: 'CONFLICT', status: 409, message, details })
  }
}

/**
 * A versioned write lost its race: the item moved between the read and the write.
 *
 * A `ConflictException` because to an HTTP caller it is one — still 409, still `CONFLICT` — but a
 * **retryable** one, which is the only reason it has a class of its own. Every other conflict here
 * is the stored state refusing the operation: an order that is already terminal, a route already
 * taken apart, a handle already taken. No number of attempts changes those answers. This one is two
 * writers on one item, and the loser only has to read again.
 */
export class WriteConflictException extends ConflictException {}

export class RateLimitedException extends JiraiaException {
  constructor(message: string, details?: FailureDetails | undefined) {
    super({ code: 'RATE_LIMITED', status: 429, message, details })
  }
}

/**
 * A dependency we do not own refused to answer: a carrier, a cache, a queue.
 *
 * Distinct from INTERNAL on purpose — this is the class of failure that is worth
 * retrying, and the SQS consumer wrapper decides whether to retry by checking for it.
 */
export class DependencyUnavailableException extends JiraiaException {
  constructor(dependency: string, cause: string) {
    super({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 503,
      message: `${dependency} is unavailable: ${cause}`,
      details: { dependency, cause }
    })
  }
}

export const isJiraiaException = (error: unknown): error is JiraiaException => error instanceof JiraiaException

/** True when retrying the same operation could plausibly succeed. */
export const isRetryable = (error: unknown): boolean => {
  if (!isJiraiaException(error)) {
    return true
  }

  // Checked by class rather than by code, so the 409 body an HTTP caller reads stays `CONFLICT`.
  // The distinction this draws is about who should try again, not about what refused: a lost
  // versioned write is the one conflict another attempt fixes, because reading the item again is
  // the whole of the retry.
  if (error instanceof WriteConflictException) {
    return true
  }

  return error.code === 'DEPENDENCY_UNAVAILABLE' || error.code === 'RATE_LIMITED'
}

/** How deep a chain of causes is followed: past this, a cycle or a pathological chain is cut. */
const CAUSE_DEPTH = 5

/**
 * An error as a log line: its message and, each in turn, what caused it — where a driver such as
 * Drizzle keeps the database's own reason behind its "Failed query".
 *
 * @example describeError(new Error('Failed query', { cause: new Error('size limit') }))   // 'Error: Failed query — caused by Error: size limit'
 */
export const describeError = (error: unknown): string => {
  const parts: string[] = []
  let current: unknown = error
  while (current !== undefined && current !== null && parts.length < CAUSE_DEPTH) {
    parts.push(String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(' — caused by ')
}
