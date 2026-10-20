import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { ValidationException } from '@jiraia/core'

/**
 * The secrets of the Slack connection (Etapa 5e, ADR-0018), from one key in the environment: the bot's
 * token encrypted at rest (AES-256-GCM), and the OAuth `state` signed, so the callback is answered only
 * for the admin who started it, within ten minutes.
 */
export type SlackSecrets = {
  seal(token: string): string
  open(sealed: string): string
  state(memberId: string, now: Date): string
  checkState(state: string, memberId: string, now: Date): void
}

const STATE_TTL_MS = 10 * 60_000

const base64url = (bytes: Buffer) => bytes.toString('base64url')

export class KeySlackSecrets implements SlackSecrets {
  private readonly key: Buffer

  constructor(key: string) {
    this.key = Buffer.from(key, 'base64')
    if (this.key.length !== 32) {
      throw new Error('SLACK_TOKEN_KEY must be 32 bytes, base64')
    }
  }

  /** `iv.tag.ciphertext`, each base64url. */
  seal(token: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), sealed].map(base64url).join('.')
  }

  open(sealed: string): string {
    const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'))
    if (!iv || !tag || !data) {
      throw new Error('A sealed Slack token has three parts')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url')
  }

  state(memberId: string, now: Date): string {
    const payload = `${memberId}.${now.getTime() + STATE_TTL_MS}`
    return `${payload}.${this.sign(payload)}`
  }

  checkState(state: string, memberId: string, now: Date): void {
    const [id, expires, signature] = state.split('.')
    const expected = Buffer.from(this.sign(`${id}.${expires}`))
    const given = Buffer.from(signature ?? '')
    const genuine = given.length === expected.length && timingSafeEqual(given, expected)
    if (!genuine || id !== memberId || Number(expires) < now.getTime()) {
      throw new ValidationException('The Slack connection expired or was started by someone else; start it again')
    }
  }
}
