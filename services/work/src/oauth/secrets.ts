import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Prefixes that tell an OAuth token apart from an API token (`jia_`), in logs and in the router. */
export const ACCESS_PREFIX = 'jioa_'
export const REFRESH_PREFIX = 'jior_'
const CODE_PREFIX = 'jioc_'

const _random = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`

export const newAccessToken = (): string => _random(ACCESS_PREFIX)
export const newRefreshToken = (): string => _random(REFRESH_PREFIX)
export const newCode = (): string => _random(CODE_PREFIX)

/** What the database keeps: a SHA-256 is enough for 256 random bits. */
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * PKCE with S256 (RFC 7636): the verifier the client kept hashes to the challenge it sent first.
 *
 * @example pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')   // true
 */
export const pkceMatches = (verifier: string, challenge: string): boolean => {
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}
