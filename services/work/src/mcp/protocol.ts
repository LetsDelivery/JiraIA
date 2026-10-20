import { z } from 'zod'

/**
 * The part of the Model Context Protocol a stateless tool server speaks (ADR-0020): JSON-RPC 2.0
 * messages, one per POST, and the protocol versions it answers in.
 */

/** Newest first: the one answered when a client asks for a version not listed. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0]

const idSchema = z.union([z.string(), z.number().int()])
export type JsonRpcId = z.infer<typeof idSchema>

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: idSchema,
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional()
})
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>

/** A notification has no id; a response from the client carries `result` or `error`. Both get 202. */
const notificationSchema = z.object({ jsonrpc: z.literal('2.0'), method: z.string().min(1) })
const clientResponseSchema = z
  .object({ jsonrpc: z.literal('2.0'), id: idSchema })
  .and(z.union([z.object({ result: z.unknown() }), z.object({ error: z.unknown() })]))

export type Incoming =
  | { kind: 'request'; request: JsonRpcRequest }
  | { kind: 'accepted' }
  | { kind: 'invalid'; id: JsonRpcId | null; reason: string }

/**
 * What one POST carried: a request to answer, something only to accept, or something not JSON-RPC.
 *
 * @example classify({ jsonrpc: '2.0', method: 'notifications/initialized' })   // { kind: 'accepted' }
 */
export const classify = (body: unknown): Incoming => {
  const request = jsonRpcRequestSchema.safeParse(body)
  if (request.success) {
    return { kind: 'request', request: request.data }
  }
  if (notificationSchema.safeParse(body).success || clientResponseSchema.safeParse(body).success) {
    return { kind: 'accepted' }
  }
  const id = idSchema.safeParse((body as { id?: unknown } | null)?.id)
  return {
    kind: 'invalid',
    id: id.success ? id.data : null,
    reason: Array.isArray(body)
      ? 'Batches are not accepted; send one message per request'
      : 'Not a JSON-RPC 2.0 message'
  }
}

/** JSON-RPC's own codes, for what never reached a tool. */
export const RPC_ERROR = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603
} as const

export const jsonRpcResponseSchema = z.union([
  z.object({ jsonrpc: z.literal('2.0'), id: idSchema, result: z.record(z.string(), z.unknown()) }),
  z.object({
    jsonrpc: z.literal('2.0'),
    id: idSchema.nullable(),
    error: z.object({ code: z.number().int(), message: z.string() })
  })
])
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>

export const rpcResult = (id: JsonRpcId, result: Record<string, unknown>): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result
})

export const rpcError = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message }
})

/**
 * The version to answer `initialize` in: the client's, when it is one this server speaks.
 *
 * @example negotiate('2025-06-18')   // '2025-06-18'
 * @example negotiate('2024-01-01')   // '2025-11-25'
 */
export const negotiate = (requested: unknown): string =>
  PROTOCOL_VERSIONS.find((version) => version === requested) ?? LATEST_PROTOCOL_VERSION

/** A `MCP-Protocol-Version` header, when sent, must name a version this server speaks. */
export const isKnownVersion = (header: string | undefined): boolean =>
  header === undefined || PROTOCOL_VERSIONS.some((version) => version === header)

/** The arguments of `tools/call`. */
export const toolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({})
})
