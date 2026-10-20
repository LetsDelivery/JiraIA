import { AsyncLocalStorage } from 'node:async_hooks'

const scope = new AsyncLocalStorage<string>()

/**
 * Runs `work` as written through an application (ADR-0022): every audit event inside records its
 * name, so a card's history reads "Stênio criou o card (via Laís)".
 */
export const throughApplication = <T>(application: string | undefined, work: () => Promise<T>): Promise<T> =>
  application ? scope.run(application, work) : work()

/** The application the running write came through, if any. */
export const currentApplication = (): string | undefined => scope.getStore()
