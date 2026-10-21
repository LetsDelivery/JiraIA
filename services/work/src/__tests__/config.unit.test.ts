import { describe, expect, it } from 'bun:test'

import { readConfig } from '../config.js'

const env = {
  DATABASE_URL: 'postgres://unused',
  AWS_REGION: 'us-east-1',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'wss://unused/live'
}

describe('readConfig', () => {
  it('reads the allowed domains from the comma-separated list the template sets', () => {
    const config = readConfig({ ...env, ALLOWED_EMAIL_DOMAINS: ' USELETS.com , lets.delivery ,' })
    expect(config.ALLOWED_EMAIL_DOMAINS).toEqual(['uselets.com', 'lets.delivery'])
  })

  it('refuses a list with no domain in it, naming the variable', () => {
    expect(() => readConfig({ ...env, ALLOWED_EMAIL_DOMAINS: ' , ,' })).toThrow('ALLOWED_EMAIL_DOMAINS')
  })
})
