# 9. Pages live in `work`, and are edited together through Yjs over a WebSocket API

Date: 2026-10-16

## Status

Accepted. Amends ADR-0003, which expected `pages` to be its own service. Amended by ADR-0011: pages
belong to Let’s Draw AI's own spaces, beside folders and whiteboards, and every member edits them.

## Context

Etapa 4 brings pages: a tree per space, a rich editor (TipTap), editing by several people at once,
versions that can be compared and restored, comments, and cards mentioned or embedded in a page.
The stack names the pieces (arquitetura.md): API Gateway WebSocket + Lambda, Yjs, no containers.

Two things had to be decided that the code alone would not explain: where pages live, and how a
document edited by several browsers is kept — with no server process holding it in memory between
two messages.

## Decision

**Pages are a module of `work`, not a service.** Every page question is a space question first —
who may read or write it is the space role (ADR-0004), and a page embeds the space's cards. As a
separate service, each request would cross a service boundary to ask `work` for the caller's role.
ADR-0003's own test for a split ("its own data and its own reasons to change") is not met yet. The
realtime handler is a second Lambda of `work`, sharing its schema and code.

**The document is a Yjs CRDT, kept as updates in Postgres.**

- `pages.document` holds a merged Yjs state (base64); `page_updates` holds the updates since. The
  state is `Y.mergeUpdates(document, ...updates)` — no `Y.Doc` is built on the server and no editor
  schema is needed there. Past 50 updates the state is merged back into `pages.document`.
- A browser loads the state over HTTP (`GET /pages/{id}/document`) — a WebSocket frame is limited to
  128 KB — then connects to the WebSocket API and sends each local change as an update. The handler
  stores it and relays it to the page's other connections (`PostToConnection`); awareness (cursors,
  names) is relayed and never stored.
- **Connecting needs a ticket.** A browser cannot set an `Authorization` header on a WebSocket, and the
  WebSocket API has no JWT authorizer. The HTTP API, behind the Google JWT authorizer, issues a
  one-use ticket (`POST /pages/{id}/realtime`, 60 seconds) recorded with the member and whether they
  may write; `$connect` takes it and deletes it. No signing secret to keep.
- A reader connects too — they see others edit — but updates from a connection that may not write are
  dropped.

**What the server reads of a page comes from the editor.** Search, the read-only view, versions and
the diff need the page as text and as ProseMirror JSON, which only the editor (with its schema) can
produce from the Yjs state. The browser that edits sends them (`PUT /pages/{id}/content`), debounced.
They are a derived copy; the Yjs state is the source.

**Versions are the content's audit trail.** Keystrokes are not audit events. A version — number,
author, title, JSON, text and the Yjs state at that moment — is taken when content is saved and the
last version is older than ten minutes or by someone else, and whenever someone asks for one. Taking
a version, restoring one, and every change to the tree are audit events. Restoring sets the old
content in the live editor, so it reaches everyone editing as an ordinary change, and is recorded as
a new version.

**Guests do not see pages.** A guest's role is to see the cards they are on (ADR-0007); a page is a
space's document. Readers read and comment.

## Consequences

- A WebSocket API, a `realtime` Lambda and its permission to post to connections join `work`'s
  template; the local harness serves the same handler on `/realtime` with Bun's WebSockets.
- Two people editing are consistent because Yjs merges, not because the server orders anything: the
  handler only stores and relays. A lost relay is repaired the next time the page is opened.
- The HTTP router stays small: no Yjs doc in memory, only base64 strings merged by `yjs`.
- If `work` grows too large to change safely, pages can still leave it — its tables already sit apart
  (`pages`, `page_*`) and reach `work` only through the space gate.
