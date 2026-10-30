/** The name an assistant lists JiraIA under. */
export const MCP_SERVER_NAME = 'jiraia'

/**
 * The MCP endpoint (ADR-0020) as an assistant reaches it: the panel's own origin, through the same
 * `/api` the panel calls. An assistant needs only this address; it signs in by OAuth (ADR-0021).
 *
 * @example mcpUrl('https://jiraia.uselets.com', '/api')   // 'https://jiraia.uselets.com/api/work/v1/mcp'
 */
export const mcpUrl = (origin: string, apiBase: string): string => new URL(`${apiBase}/work/v1/mcp`, origin).href

/** The line that adds JiraIA to Claude Code; `/mcp` inside it then signs in. */
export const claudeCodeCommand = (url: string): string => `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`

/** Cursor's install link: the server's configuration, as base64 JSON. */
export const cursorInstallLink = (url: string): string =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`

/** VS Code's install link: the server's configuration, as URL-encoded JSON. */
export const vscodeInstallLink = (url: string): string =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url }))}`

/** The assistants Integrações offers, in the order it lists them. */
export const ASSISTANTS = ['lais', 'claude', 'claudeCode', 'cursor', 'vscode'] as const
export type Assistant = (typeof ASSISTANTS)[number]

/** How each assistant shows up once it registered itself: the name it gave, or where it sends people back. */
const RECOGNIZED: ReadonlyArray<readonly [Assistant, (name: string, host: string) => boolean]> = [
  ['claudeCode', (name) => /claude code/i.test(name)],
  ['claude', (name, host) => /(^|\.)claude\.(ai|com)$/i.test(host) || /^claude$/i.test(name.trim())],
  ['cursor', (name) => /cursor/i.test(name)],
  ['vscode', (name, host) => /visual studio code|vs ?code/i.test(name) || host === 'vscode.dev'],
  ['lais', (name) => /(^|\s)la[ií]s(\s|$)/i.test(name)]
]

/**
 * Which assistant a connected application is, if it is one Integrações lists.
 *
 * @example assistantOf({ name: 'Claude', redirectHost: 'claude.ai' })   // 'claude'
 */
export const assistantOf = (application: { name: string; redirectHost: string }): Assistant | undefined =>
  RECOGNIZED.find(([, matches]) => matches(application.name, application.redirectHost))?.[0]

/** The person's connections, grouped by the assistant each belongs to. */
export const connectionsByAssistant = <T extends { application: { name: string; redirectHost: string } }>(
  connections: readonly T[]
): Partial<Record<Assistant, T[]>> => {
  const groups: Partial<Record<Assistant, T[]>> = {}
  for (const connection of connections) {
    const assistant = assistantOf(connection.application)
    if (assistant) {
      groups[assistant] = [...(groups[assistant] ?? []), connection]
    }
  }
  return groups
}
