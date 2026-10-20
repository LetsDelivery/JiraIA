import { describe, expect, it } from 'bun:test'

import { currentApplication, throughApplication } from '../via.js'

describe('throughApplication', () => {
  it('names the application inside only, and nothing when there is none', async () => {
    expect(await throughApplication('Laís', async () => currentApplication())).toBe('Laís')
    expect(await throughApplication(undefined, async () => currentApplication())).toBeUndefined()
    expect(currentApplication()).toBeUndefined()
  })
})
