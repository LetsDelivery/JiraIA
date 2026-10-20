# 20. The MCP server is a route of `work`, speaking stateless Streamable HTTP

Date: 2026-10-19

## Status

Accepted. Etapa 6b (escopo-mvp 4.9). Amends `docs/produto/arquitetura.md`, which named
`@modelcontextprotocol/sdk` in a Lambda. Its write tools are amended by ADR-0022: a person writes at
once; only an agent proposes.

## Context

Stênio wants other platforms — an assistant of his own, Claude, the routines of the product repository —
to connect to JiraIA through MCP: read, search, and ask for changes. Every change an agent makes goes
through a proposal (ADR-0019). The connection by OAuth is Etapa 6c; until then a client sends an API
token (ADR-0015).

The official SDK's server transports sit on Express or Hono and Node's request objects, and bring
both into the bundle. What a stateless server needs from the protocol is small: JSON-RPC over one POST,
`initialize`, `ping`, `tools/list` and `tools/call`.

## Decision

- **`POST /mcp`** on the `work` router, reached at `/work/v1/mcp` with `Authorization: Bearer jia_…`.
  It speaks MCP's Streamable HTTP transport **without sessions**: each POST carries one JSON-RPC
  message; a request gets one `application/json` answer, a notification or a response gets `202`, and
  `GET`/`DELETE` answer `405` because the server opens no stream. Protocol versions `2025-11-25`,
  `2025-06-18` and `2025-03-26` are accepted; an unknown `MCP-Protocol-Version` header is a 400.
- **The protocol is ours, in `mcp/protocol.ts`**: zod schemas for the messages, version negotiation and
  JSON-RPC errors. The SDK is a dev dependency only: the integration suite connects to the router with
  the SDK's own client, so the server is proven against the reference implementation.
- **Tools call the services with the caller**, so roles, the reader floor and archived spaces apply as
  on the panel. Cards are named by key (`PRD-12`) and spaces by key; the tool turns them into ids.
  Read tools: `list_spaces`, `describe_space` (states, types, custom fields), `search`, `query_cards`
  (the structured filter of ADR-0008), `get_card` (with comments and links), `get_page`,
  `list_members`, `list_proposals`, `get_proposal`.
- **Writes are proposals.** `propose_changes` and `comment_on_card` create a proposal; the answer says
  whether it waits for a person or the space applied it on arrival; `get_proposal` reads the decision,
  the note and each item's fate; `withdraw_proposal` takes it back. These tools are listed only to an
  agent — a person's token gets the read tools.
- **Errors:** a failure inside a tool (not found, refused, invalid arguments) is a tool result with
  `isError`, naming the problem so the model can correct itself; an unknown tool or method is a JSON-RPC
  error.

## Consequences

- No server-to-client stream: no progress notifications, no sampling, no subscriptions. None of the
  tools needs them; a later version can add an SSE answer without changing the tools.
- Following a new protocol version is ours to do; the SDK client in the suite tells when it breaks.
- Until Etapa 6c, connecting needs a token pasted into the client — service accounts for agents.
