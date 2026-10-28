import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createLogger } from '@jiraia/logger'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { createHttpClient } from '../client.js'

/** A downloaded file comes back byte for byte; read as text, these bytes would not survive. */
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe])
const server = setupServer(http.get('https://files.counterparty.test/a.png', () => new HttpResponse(PNG_HEAD)))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

const client = createHttpClient({ provider: 'files', logger: createLogger('http', 'test') })

describe('createHttpClient', () => {
  it('answers the body as bytes, untouched, when the request is binary', async () => {
    const answer = await client.send({ method: 'GET', url: 'https://files.counterparty.test/a.png', binary: true })

    expect(answer.bytes).toEqual(PNG_HEAD)
    expect(answer.body).toBe('')
  })

  it('keeps answering text otherwise', async () => {
    const answer = await client.send({ method: 'GET', url: 'https://files.counterparty.test/a.png' })

    expect(answer.bytes).toBeUndefined()
    expect(typeof answer.body).toBe('string')
  })
})
