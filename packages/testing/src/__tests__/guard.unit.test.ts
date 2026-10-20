import { describe, expect, it } from 'bun:test'

import { databaseRefusal } from '../guard.js'
import { isPermittedHost } from '../offline.js'

describe('databaseRefusal', () => {
  it('accepts the test container', () => {
    expect(databaseRefusal('postgres://jiraia:jiraia@127.0.0.1:8210/jiraia_test')).toBeUndefined()
  })

  it('refuses the dev container, which holds data somebody is working on', () => {
    expect(databaseRefusal('postgres://jiraia:jiraia@127.0.0.1:8200/jiraia')?.details).toEqual([
      'port 8200 is not 8210',
      'database "/jiraia" is not jiraia_test'
    ])
  })

  it('refuses a remote host even on the right port', () => {
    expect(
      databaseRefusal('postgres://u:p@jiraia.cluster.us-east-1.rds.amazonaws.com:8210/jiraia_test')?.details
    ).toEqual(['host "jiraia.cluster.us-east-1.rds.amazonaws.com" is not loopback'])
  })

  it('refuses a missing URL', () => {
    expect(databaseRefusal(undefined)?.title).toContain('missing')
  })
})

describe('isPermittedHost', () => {
  it('permits loopback and the masked mock suffix', () => {
    expect(isPermittedHost('127.0.0.1')).toBe(true)
    expect(isPermittedHost('[::1]')).toBe(true)
    expect(isPermittedHost('slack.counterparty.test')).toBe(true)
  })

  it('refuses a real host', () => {
    expect(isPermittedHost('api.anthropic.com')).toBe(false)
  })
})
