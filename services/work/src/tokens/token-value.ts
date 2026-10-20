import { createHash, randomBytes } from 'node:crypto'

/** Every API token starts with this, so a leaked one is recognisable in logs and by secret scanners. */
export const TOKEN_PREFIX = 'jia_'

const SHAPE = /^jia_[A-Za-z0-9_-]{43}$/

/** A new token: 32 random bytes, base64url, after the prefix. Shown once; only its hash is kept. */
export const newTokenValue = (): string => `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`

/**
 * What the database keeps instead of the token: a SHA-256 is enough for a random 256-bit secret —
 * there is nothing to guess, so no slow hash is needed.
 */
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Whether a string has a token's shape — checked before any lookup. */
export const isTokenValue = (value: string): boolean => SHAPE.test(value)

/**
 * The part of a token a screen may show to tell two apart.
 *
 * @example tokenHint('jia_AbCdEfGh…')   // 'jia_AbCdEfGh'
 */
export const tokenHint = (value: string): string => value.slice(0, TOKEN_PREFIX.length + 8)
