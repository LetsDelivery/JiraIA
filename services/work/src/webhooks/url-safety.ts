import { ValidationException } from '@jiraia/core'

/** Names that only ever reach machines inside a network. */
const INTERNAL_NAMES = /(^localhost$)|(\.localhost$)|(\.local$)|(\.internal$)|(\.lan$)/i

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Loopback, private, link-local (cloud metadata lives there), CGNAT and unspecified IPv4 ranges. */
const _privateIpv4 = (host: string): boolean => {
  const match = IPV4.exec(host)
  if (!match) {
    return false
  }
  const [a = 0, b = 0] = [Number(match[1]), Number(match[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** Any IPv6 literal — loopback, unique-local and mapped addresses included — is refused outright. */
const _ipv6 = (host: string): boolean => host.startsWith('[') || host.includes(':')

/**
 * A webhook may only point at a public HTTPS address: no plain HTTP, no internal name, no private or
 * loopback IP — otherwise a space admin could make JiraIA probe the network it runs in.
 *
 * Names are checked as written; one that resolves to a private address is the residual risk, kept
 * small because the Lambda runs outside any VPC (ADR-0002).
 *
 * @example assertPublicHttps('https://hooks.zapier.com/x')   // passes
 * @example assertPublicHttps('https://169.254.169.254/')    // throws
 */
export const assertPublicHttps = (url: string): void => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationException(`Webhook address "${url}" is not a URL`, { url })
  }
  const host = parsed.hostname
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new ValidationException(`Webhook address "${url}" must be https, with no credentials in it`, { url })
  }
  if (INTERNAL_NAMES.test(host) || _privateIpv4(host) || _ipv6(host)) {
    throw new ValidationException(`Webhook address "${url}" points inside a network`, { url })
  }
}
