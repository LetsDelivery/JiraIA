import { ValidationException } from '@jiraia/core'
import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'

import type { McpServer } from './mcp-server.js'
import { isKnownVersion, jsonRpcResponseSchema, PROTOCOL_VERSIONS, RPC_ERROR, rpcError } from './protocol.js'

/** What `GET` and `DELETE` answer: this server opens no stream and keeps no session (ADR-0020). */
const noStream = async () => ({
  statusCode: 405,
  body: rpcError(null, RPC_ERROR.invalidRequest, 'This MCP server is stateless: send messages with POST')
})

/**
 * The MCP endpoint (escopo-mvp 4.9, ADR-0020), at `/work/v1/mcp` with an API token. One JSON-RPC
 * message per POST; requests get their answer, notifications and responses a 202.
 */
export const mcpRoutes = (server: McpServer): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/mcp',
    requires: 'authenticated',
    delegated: true,
    schemas: { body: z.unknown() },
    responds: jsonRpcResponseSchema,
    handler: async ({ caller, body, headers }) => {
      const version = headers['mcp-protocol-version']
      if (!isKnownVersion(version)) {
        throw new ValidationException(
          `MCP-Protocol-Version "${version}" is not supported; use one of ${PROTOCOL_VERSIONS.join(', ')}`,
          { version: version ?? null }
        )
      }
      const answer = await server.handle(caller, body)
      return answer.kind === 'accepted' ? { statusCode: 202 } : { statusCode: 200, body: answer.response }
    }
  }),
  defineRoute({
    method: 'GET',
    path: '/mcp',
    requires: 'authenticated',
    delegated: true,
    schemas: {},
    responds: jsonRpcResponseSchema,
    handler: noStream
  }),
  defineRoute({
    method: 'DELETE',
    path: '/mcp',
    requires: 'authenticated',
    delegated: true,
    schemas: {},
    responds: jsonRpcResponseSchema,
    handler: noStream
  })
]
