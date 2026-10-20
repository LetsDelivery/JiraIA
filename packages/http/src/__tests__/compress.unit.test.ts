import { describe, expect, it } from 'bun:test'
import { gunzipSync } from 'node:zlib'

import { acceptsGzip, compressed } from '../compress.js'

const event = (headers: Record<string, string> = {}) => ({ headers })

/** Comfortably over the 1 KB threshold, and realistic: JSON compresses because it repeats itself. */
const listing = JSON.stringify({
  items: Array.from({ length: 40 }, (_, index) => ({
    key: `REQ-${index}`,
    projectId: 'dfd9588e-d8ba-4c29-af7f-36af7437775b',
    title: 'Formulário de requisição',
    state: 'Backlog',
    priority: 'MEDIUM'
  }))
})

const response = (body: string) => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body })

describe('acceptsGzip', () => {
  it('reads the header the gateway sends', () => {
    expect(acceptsGzip(event({ 'accept-encoding': 'gzip, deflate, br' }))).toBe(true)
  })

  // API Gateway v2 lowercases header names; the local harness and these tests build events by hand.
  it('does not care how the header was capitalised', () => {
    expect(acceptsGzip(event({ 'Accept-Encoding': 'GZIP' }))).toBe(true)
  })

  it('is false when the caller asked for something else, or for nothing', () => {
    expect(acceptsGzip(event({ 'accept-encoding': 'br' }))).toBe(false)
    expect(acceptsGzip(event())).toBe(false)
  })
})

describe('compressed', () => {
  it('gzips a listing and says so', () => {
    const out = compressed(response(listing), event({ 'accept-encoding': 'gzip' }))

    expect(out.headers?.['content-encoding']).toBe('gzip')
    expect(out.isBase64Encoded).toBe(true)
    expect(out.headers?.['content-type']).toBe('application/json')
    expect(out.statusCode).toBe(200)
  })

  // The whole point, and the number the decision was made on.
  it('takes most of the body off', () => {
    const out = compressed(response(listing), event({ 'accept-encoding': 'gzip' }))

    expect(Buffer.from(out.body as string, 'base64').length).toBeLessThan(listing.length / 4)
  })

  it('round-trips to exactly what went in', () => {
    const out = compressed(response(listing), event({ 'accept-encoding': 'gzip' }))

    expect(gunzipSync(Buffer.from(out.body as string, 'base64')).toString('utf8')).toBe(listing)
  })

  it('leaves the body alone when the caller cannot take gzip', () => {
    expect(compressed(response(listing), event())).toEqual(response(listing))
  })

  /**
   * Under a kilobyte, gzip's own header plus base64's third makes the response bigger, and the CPU
   * is billed either way. Every listing is far above the line and every health check far below it.
   */
  it('leaves a small body alone even when gzip was offered', () => {
    const small = response(JSON.stringify({ service: 'oms', status: 'ok' }))

    expect(compressed(small, event({ 'accept-encoding': 'gzip' }))).toEqual(small)
  })

  it('leaves a 204 alone, which has no body at all', () => {
    const empty = { statusCode: 204 }

    expect(compressed(empty, event({ 'accept-encoding': 'gzip' }))).toEqual(empty)
  })

  /** Compressing twice would produce a body the client decodes once and cannot read. */
  it('does not compress something already encoded', () => {
    const already = { ...response(listing), isBase64Encoded: true }

    expect(compressed(already, event({ 'accept-encoding': 'gzip' }))).toEqual(already)
  })
})
