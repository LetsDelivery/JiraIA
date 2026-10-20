import { createLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import { agentTools } from './agent-tools.js'
import { McpServer } from './mcp-server.js'
import { personTools } from './person-tools.js'
import { type ReadDeps, readTools } from './read-tools.js'

/**
 * The MCP server (Etapa 6b, ADR-0020, ADR-0022): reading for everyone; writing at once for a person,
 * by proposal for an agent.
 */
export const buildMcp = (deps: ReadDeps & { access: AccessResolver; webUrl: string }) =>
  new McpServer({
    access: deps.access,
    tools: [...readTools(deps), ...personTools(deps), ...agentTools(deps)],
    logger: createLogger('work', 'mcp')
  })
