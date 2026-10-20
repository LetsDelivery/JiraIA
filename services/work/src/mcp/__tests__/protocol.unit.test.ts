import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { classify, isKnownVersion, negotiate, rpcError, rpcResult } from '../protocol.js'
import { describeTool, toolError, toolResult } from '../tool.js'

describe('classify', () => {
  it('tells a request from what is only acknowledged', () => {
    expect(classify({ jsonrpc: '2.0', id: 1, method: 'ping' })).toMatchObject({ kind: 'request' })
    expect(classify({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({ kind: 'accepted' })
    expect(classify({ jsonrpc: '2.0', id: 'a', result: {} })).toEqual({ kind: 'accepted' })
  })

  it('refuses batches and anything not JSON-RPC 2.0, keeping the id when there is one', () => {
    expect(classify([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).toMatchObject({ kind: 'invalid', id: null })
    expect(classify({ jsonrpc: '1.0', id: 7, method: 'ping' })).toMatchObject({ kind: 'invalid', id: 7 })
    expect(classify(undefined)).toMatchObject({ kind: 'invalid', id: null })
  })
})

describe('versions', () => {
  it('answers in the client version when spoken here, else the newest', () => {
    expect(negotiate('2025-03-26')).toBe('2025-03-26')
    expect(negotiate('2024-11-05')).toBe('2025-11-25')
    expect(negotiate(undefined)).toBe('2025-11-25')
  })

  it('accepts a missing header and refuses an unknown one', () => {
    expect(isKnownVersion(undefined)).toBe(true)
    expect(isKnownVersion('2025-06-18')).toBe(true)
    expect(isKnownVersion('2030-01-01')).toBe(false)
  })
})

describe('answers', () => {
  it('are JSON-RPC 2.0', () => {
    expect(rpcResult(1, {})).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect(rpcError(null, -32600, 'x')).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'x' } })
  })

  it('carry a tool result as text and as data, and an error as text', () => {
    expect(toolResult({ a: 1 })).toMatchObject({
      content: [{ type: 'text', text: '{"a":1}' }],
      structuredContent: { a: 1 }
    })
    expect(toolResult([1])).toMatchObject({ structuredContent: { result: [1] } })
    expect(toolError('no')).toEqual({ content: [{ type: 'text', text: 'no' }], isError: true })
  })

  it('describe a tool with its input as JSON Schema, read-only unless it writes', () => {
    const tool = {
      name: 't',
      title: 'T',
      description: 'd',
      input: z.object({ n: z.number().default(1) }),
      run: async () => 1
    }
    const described = describeTool(tool)
    expect(described.inputSchema).toMatchObject({ type: 'object', properties: { n: { type: 'number' } } })
    expect(described.annotations.readOnlyHint).toBe(true)
    expect(describeTool({ ...tool, writes: true }).annotations.readOnlyHint).toBe(false)
  })
})
