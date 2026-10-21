import { gzipSync } from 'node:zlib'

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

/**
 * gzip on the way out, because nothing above us does it.
 *
 * The API is an HTTP API (`template.yml`) — API Gateway **v2** — and v2 has no response
 * compression at all: `MinimumCompressionSize` is a REST API (v1) property and there is no
 * equivalent. So a listing leaves the account uncompressed unless the handler compresses it, and
 * egress is billed per byte.
 *
 * Measured on LetsDelivery/uselets rows: a page of summaries loses about 90% of its size. A board
 * of thousands of cards is exactly that shape.
 */

/**
 * Below this, gzip is not worth doing.
 *
 * A small body compresses to about its own size once the gzip header and the base64 expansion are
 * counted, and the CPU is billed either way. 1 KB is where the trade turns: every listing is far
 * above it and every 204, health check and single-field write is far below.
 */
const THRESHOLD = 1024

/**
 * Whether the caller said it could take gzip.
 *
 * Case-insensitive on the header name: API Gateway v2 lowercases them, but the local harness and the
 * tests build events by hand and a header that is only sometimes matched is worse than one never
 * matched — it would work everywhere except where somebody typed it differently.
 */
export const acceptsGzip = (event: Pick<APIGatewayProxyEventV2, 'headers'>): boolean => {
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (name.toLowerCase() === 'accept-encoding') {
      return (value ?? '').toLowerCase().includes('gzip')
    }
  }

  return false
}

/**
 * The response, compressed when that is both allowed and worth it.
 *
 * Applied at the router's edge so it covers failures as well as successes — an error body is small
 * and falls under the threshold, which is the right outcome rather than a special case.
 *
 * `isBase64Encoded` is how a Lambda hands binary to API Gateway: the gateway decodes it and sends
 * the raw bytes on, so the browser sees ordinary gzip. Without the flag the client would receive
 * base64 text labelled as gzip and fail to decode it.
 *
 * @example compressed(ok({ items }), event)
 */
export const compressed = (
  response: APIGatewayProxyStructuredResultV2,
  event: Pick<APIGatewayProxyEventV2, 'headers'>
): APIGatewayProxyStructuredResultV2 => {
  const body = response.body

  if (typeof body !== 'string' || body.length < THRESHOLD || response.isBase64Encoded) {
    return response
  }

  if (!acceptsGzip(event)) {
    return response
  }

  return {
    ...response,
    headers: { ...response.headers, 'content-encoding': 'gzip' },
    body: gzipSync(Buffer.from(body, 'utf8')).toString('base64'),
    isBase64Encoded: true
  }
}
