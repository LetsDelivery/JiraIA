# 27. A Yjs state is collected when merged, read in pieces, and sent in batches

Date: 2026-10-22

## Status

Accepted. Amends ADR-0009: the server applies a page's state to a bare `Y.Doc` instead of
`Y.mergeUpdates`, and a browser sends its changes in batches. Amends ADR-0002: the local `pg` wire
refuses a result over the Data API's 1 MiB, as AWS does.

## Context

On 2026-10-22 every screen of LET’S Draw AI in the dev account answered "Não foi possível concluir".
One whiteboard's stored `document` had grown past 1 MiB, and the RDS Data API refuses to return more
than that to one statement. Every query that read the `contents` row failed: the space's tree, the
latest and opened lists (which selected whole rows), the board itself, its versions, and the realtime
handler's compaction — so the board could not even shrink.

It had grown because of three choices that were each reasonable alone:

- ADR-0009 merged updates with `Y.mergeUpdates`, which never collects deleted content. A whiteboard
  writes an element again on every pointer move of a drag, so the stored state kept every step of
  every drag ever made. A simulation of 50 drags of 20 elements: about 10.5 MB merged, 376 KB once
  applied to a `Y.Doc`.
- The browser sent each Yjs update on its own: 30 to 60 WebSocket messages a second while dragging,
  each a Lambda invocation and three or four Data API statements.
- Locally and in the tests the `pg` driver has no such limit, so nothing failed before AWS did.

Drizzle reported only "Failed query"; the Data API's reason was in `error.cause`, which was not logged.

## Decision

- **Merging collects.** `mergeState` applies the stored state and the updates to a `Y.Doc` and encodes
  it again. The doc never names its types, so the server still needs neither the editor nor its schema;
  an update that arrives before the one it builds on stays pending inside the state, as in a merge.
  Clients holding the old state converge with the collected one.
- **A document is never read with its row.** Rows of `contents` and `content_versions` are read
  without `document` (`ContentRow`, `VersionRow`). The document is read by its length and then in
  pieces of 500 000 characters (`substr`), and the pending updates in batches under the same size, so a
  state of any size is read without one answer passing 1 MiB. A stored document longer than one piece
  is merged again when the page is opened, which repairs a state written before this decision.
- **Compaction counts, it does not read.** Whether to compact is a `count()` of pending updates.
- **The browser batches.** Local changes go out at most every 100 ms, as the doc's own difference since
  the last send (`encodeStateAsUpdate(doc, shared)`). The browser's doc has already collected what a
  drag overwrote, so the steps in between reach neither the server nor the stored state. What arrives
  from others is applied after local changes are sent, and never sent back.
- **The limit is kept locally.** `connectDatabase` with `DATABASE_URL` refuses a result over 1 MiB with
  the Data API's own words, so `bun run up`, `local:serve` and the test suite fail where AWS would.
- **Errors keep their cause.** The router and the realtime handler log `describeError(error)`: the
  message and its chain of causes.

## Consequences

- The board that failed is repaired the next time it is opened, with no hand-written SQL.
- A drag costs one message per 100 ms instead of one per pointer move: about a tenth of the WebSocket
  messages, Lambda invocations and Aurora writes, and of the growth of the stored state. Others see a
  drag move ten times a second.
- Compaction builds a `Y.Doc` in the Lambda's memory; for an ordinary page that is milliseconds.
- `content_versions.document` still holds a copy of the state at each version, written and never read.
- A collected state still grows by a few bytes per overwrite. If a board ever approaches 1 MiB after
  this, the next step is to keep the state in S3 and only its key in Postgres.
