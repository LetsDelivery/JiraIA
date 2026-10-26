/**
 * The API while its database resumes from a pause (ADR-0035): it answers 503 at once, naming the
 * database, rather than hold the request. The panel asks again until the data comes, and says why it
 * is waiting — the screen's skeleton or the button's spinner stays up meanwhile.
 */

/** Between two tries; a resume takes some seconds. */
export const RETRY_MS = 2_000
/** Past this, the 503 is handed to the caller, which shows its usual refusal. */
export const GIVE_UP_MS = 120_000

/** What the panel shows while a request waits for the database: `end` takes it down. */
export type WaitingNotice = { begin: () => { end: () => void } }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Whether an answer is the database resuming: a 503 whose dependency is the database. */
export const isResuming = async (response: Response): Promise<boolean> => {
  if (response.status !== 503) {
    return false
  }
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  const details = (body as { error?: { details?: { dependency?: unknown } } } | undefined)?.error?.details
  return details?.dependency === 'Database'
}

/**
 * `send`, asked again while the database resumes, with the notice up from the first refusal to the
 * answer. A request is cloned for each try, so its body is sent whole every time.
 *
 * @example createClient({ fetch: resumingFetch((request) => fetch(request), wakingNotice) })
 */
export const resumingFetch =
  (send: (request: Request) => Promise<Response>, notice: WaitingNotice, now: () => number = Date.now) =>
  async (request: Request): Promise<Response> => {
    const started = now()
    let shown: { end: () => void } | undefined
    try {
      for (;;) {
        const response = await send(request.clone())
        if (!(await isResuming(response)) || now() - started >= GIVE_UP_MS) {
          return response
        }
        shown ??= notice.begin()
        await wait(RETRY_MS)
      }
    } finally {
      shown?.end()
    }
  }
