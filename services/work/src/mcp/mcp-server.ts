import { isJiraiaException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'
import type { JiraiaLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import { throughApplication } from '../audit/via.js'
import type { MemberRow } from '../members/schemas.js'
import {
  classify,
  type JsonRpcRequest,
  type JsonRpcResponse,
  negotiate,
  RPC_ERROR,
  rpcError,
  rpcResult,
  toolCallSchema
} from './protocol.js'
import { describeTool, offeredTo, type Tool, toolError, toolResult } from './tool.js'

const SERVER_INFO = { name: 'jiraia', title: 'JiraIA', version: '0.1.0' }

/** What the model reads first: how JiraIA is organized and how it changes. Machine text: English. */
const INSTRUCTIONS = [
  'JiraIA is Let’s work platform: spaces (keyed, e.g. PRD) hold cards (keyed, e.g. PRD-12); Let’s Draw AI holds pages.',
  'Read with list_spaces, describe_space, search, query_cards, get_card and get_page.',
  'For a person, create_card, update_card, comment_on_card and link_cards write at once, as that person,',
  'with their permissions. For an autonomous agent, propose_changes creates a proposal a person decides;',
  'read the decision with get_proposal.'
].join(' ')

/** What answering one POST comes to: a JSON-RPC answer, or only an acknowledgement (202). */
export type Answer = { kind: 'response'; response: JsonRpcResponse } | { kind: 'accepted' }

/**
 * JiraIA's MCP server (escopo-mvp 4.9, ADR-0020): stateless, so every message stands alone and the
 * caller is the one the router proved. Tools run with that caller's own access.
 */
export class McpServer {
  constructor(private readonly deps: { access: AccessResolver; tools: readonly Tool[]; logger: JiraiaLogger }) {}

  async handle(caller: Caller, body: unknown): Promise<Answer> {
    const incoming = classify(body)
    if (incoming.kind === 'accepted') {
      return { kind: 'accepted' }
    }
    if (incoming.kind === 'invalid') {
      return _answer(rpcError(incoming.id, RPC_ERROR.invalidRequest, incoming.reason))
    }
    return _answer(await this._request(caller, incoming.request))
  }

  private async _request(caller: Caller, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    switch (request.method) {
      case 'initialize':
        return rpcResult(request.id, {
          protocolVersion: negotiate(request.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS
        })
      case 'ping':
        return rpcResult(request.id, {})
      case 'tools/list':
        return rpcResult(request.id, { tools: (await this._available(caller)).map(describeTool) })
      case 'tools/call':
        return await this._call(caller, request)
      default:
        return rpcError(request.id, RPC_ERROR.methodNotFound, `Method "${request.method}" is not supported`)
    }
  }

  /** The tools this caller may call: every reading one; writing ones for a person, proposing ones for an agent. */
  private async _available(caller: Caller): Promise<Tool[]> {
    const actor = await this.deps.access.actor(caller)
    return this.deps.tools.filter((tool) => offeredTo(tool, actor.kind))
  }

  private async _call(caller: Caller, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const call = toolCallSchema.safeParse(request.params ?? {})
    const actor = await this.deps.access.actor(caller)
    const tool = call.success ? this.deps.tools.find((each) => each.name === call.data.name) : undefined
    if (!call.success || !tool || !offeredTo(tool, actor.kind)) {
      const name = call.success ? call.data.name : ''
      return rpcError(request.id, RPC_ERROR.invalidParams, `Tool "${name}" does not exist for this caller`)
    }
    return rpcResult(request.id, await this._run(tool, call.data.arguments, caller, actor))
  }

  /** Bad arguments and refusals go back to the model as a tool error it can correct; a bug is logged. */
  private async _run(tool: Tool, args: Record<string, unknown>, caller: Caller, actor: MemberRow) {
    const input = tool.input.safeParse(args)
    if (!input.success) {
      const issues = input.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
      return toolError(`Invalid arguments for ${tool.name} — ${issues.join('; ')}`)
    }
    try {
      // What a person does through an application is theirs, marked "via" it in the trail (ADR-0022).
      const data = await throughApplication(caller.via, () => tool.run(input.data, { caller, actor }))
      this.deps.logger.info('MCP tool called', { tool: tool.name, memberId: actor.id, via: caller.via ?? null })
      return toolResult(data)
    } catch (error) {
      if (!isJiraiaException(error)) {
        throw error
      }
      this.deps.logger.warn('MCP tool refused', { tool: tool.name, memberId: actor.id, code: error.code })
      return toolError(`${error.code}: ${error.message}`)
    }
  }
}

const _answer = (response: JsonRpcResponse): Answer => ({ kind: 'response', response })
