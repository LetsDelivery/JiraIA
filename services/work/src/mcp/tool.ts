import type { Caller } from '@jiraia/http'
import { z } from 'zod'

import type { MemberRow } from '../members/schemas.js'

/** Who called a tool: the caller the services check, and the member behind it. */
export type ToolContext = { caller: Caller; actor: MemberRow }

/**
 * One MCP tool (ADR-0020): its input as a zod schema — the JSON Schema clients read is made from it —
 * and what it does with the caller's own access. `audience` keeps a tool to people — who write
 * directly — or to agents — who propose (ADR-0022); without it, everyone gets it. `writes` and
 * `overwrites` tell clients what to confirm.
 */
export type Tool<TInput extends z.ZodObject = z.ZodObject> = {
  name: string
  title: string
  description: string
  input: TInput
  audience?: 'person' | 'agent'
  writes?: true
  overwrites?: true
  run: (input: z.infer<TInput>, context: ToolContext) => Promise<unknown>
}

/** Whether a member of this kind is offered the tool. */
export const offeredTo = (tool: Tool, kind: string): boolean => !tool.audience || tool.audience === kind

export const defineTool = <TInput extends z.ZodObject>(tool: Tool<TInput>): Tool => tool as unknown as Tool

/** What `tools/list` says of a tool: whether it writes or changes what exists; none reaches outside JiraIA. */
export const describeTool = (tool: Tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
  annotations: {
    title: tool.title,
    readOnlyHint: !tool.writes,
    destructiveHint: Boolean(tool.overwrites),
    openWorldHint: false
  }
})

/** A tool's answer: the data for a program, and the same as JSON text for a model. */
export const toolResult = (data: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: (data && typeof data === 'object' && !Array.isArray(data) ? data : { result: data }) as Record<
    string,
    unknown
  >,
  isError: false
})

/** A tool that failed: told to the model in a sentence it can act on. */
export const toolError = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true })

/** A card's key as people type it. */
export const cardKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/)
  .describe('A card key, e.g. "PRD-12"')

/** A space's key. */
export const spaceKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/)
  .describe('A space key, e.g. "PRD"')
