import { COUNTERPARTY_SUFFIX } from './config.js'

/**
 * A test may not leave this machine.
 *
 * Loopback, plus one masked suffix where MSW answers. Anything else is a mock somebody did not write,
 * and the call would succeed against a real API — Anthropic, Slack, Atlassian — and look green.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

export const isPermittedHost = (host: string): boolean => {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase()

  return LOOPBACK.has(bare) || bare.endsWith(COUNTERPARTY_SUFFIX)
}

const _hostOf = (input: string | URL | Request): string | undefined => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  return URL.canParse(target) ? new URL(target).hostname : undefined
}

export const refuseRemoteFetch = (): void => {
  const fetched = globalThis.fetch

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const host = _hostOf(input)

    if (host && !isPermittedHost(host)) {
      throw new Error(
        `REFUSED: a test tried to reach "${host}". Mock it with MSW on a host under ${COUNTERPARTY_SUFFIX}.`
      )
    }

    return await fetched(input as never, init)
  }) as typeof fetch
}
