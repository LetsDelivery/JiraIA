import { createHmac, randomBytes } from 'node:crypto'

/** A webhook's signing secret: shown once when it is made or rotated. */
export const newWebhookSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`

/**
 * The `x-jiraia-signature` header (escopo-mvp 4.7): HMAC-SHA256 of `<timestamp>.<body>` with the
 * webhook's secret. The receiver recomputes it, and refuses an old timestamp so a captured delivery
 * cannot be replayed.
 *
 * @example signature('whsec_x', 1760702400, '{"id":"…"}')   // 't=1760702400,v1=5f…'
 */
export const signature = (secret: string, timestamp: number, body: string): string =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`

/** The hint a screen shows of a secret: its prefix and last four characters. */
export const secretHint = (secret: string): string => `whsec_…${secret.slice(-4)}`
