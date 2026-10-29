import { createHmac, timingSafeEqual } from 'node:crypto'

import { ValidationException } from '@jiraia/core'

/** How long the `state` of an installation started from the panel stays good. */
const STATE_TTL_MS = 10 * 60_000

const same = (given: string, expected: string): boolean =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))

/**
 * Whether a delivery is GitHub's (ADR-0038): `X-Hub-Signature-256` is `sha256=` and the HMAC-SHA256 of
 * the raw body with the App's webhook secret, in hex.
 *
 * @example fromGitHub('secret', '{"zen":"…"}', 'sha256=5f2c…')   // true when it was signed with 'secret'
 */
export const fromGitHub = (secret: string, body: string, signature: string | undefined): boolean =>
  same(signature ?? '', `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`)

/**
 * The `state` that goes to GitHub's installation page and comes back with the admin: who started it and
 * until when, signed with a key the App's secrets derive, so the setup is completed only by them.
 */
export class InstallState {
  private readonly key: Buffer

  constructor(webhookSecret: string) {
    this.key = createHmac('sha256', webhookSecret).update('jiraia-github-install-state').digest()
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url')
  }

  issue(memberId: string, now: Date): string {
    const payload = `${memberId}.${now.getTime() + STATE_TTL_MS}`
    return `${payload}.${this.sign(payload)}`
  }

  check(state: string, memberId: string, now: Date): void {
    const [id, expires, signature] = state.split('.')
    const genuine = same(signature ?? '', this.sign(`${id}.${expires}`))
    if (!genuine || id !== memberId || Number(expires) < now.getTime()) {
      throw new ValidationException('The GitHub installation expired or was started by someone else; start it again')
    }
  }
}
