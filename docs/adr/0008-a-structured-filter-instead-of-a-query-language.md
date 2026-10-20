# 8. A structured filter instead of a query language

Date: 2026-10-16

## Status

Accepted.

## Context

Etapa 3 replaces the JQL queries Produto runs every week (`backlog/fluxo-jira.md`): requests waiting
for triage, discovery in progress, blocked cards, "launched in the last 7 days", cards of one OKR
across REQ and PRD. Jira answers them with JQL, a text language with its own parser, functions and
error messages. The same queries must later be asked by agents through the MCP server (escopo-mvp
4.9) and kept as saved views that people share.

## Decision

A filter is a **JSON object validated by zod** (`search/filter.schemas.ts`), not a text language.
Every condition named must hold; within a condition, any of its values matches. It covers space,
type, state (and its opposite), state group, assignee and reporter (with `me` and `none`),
priority, labels (any of, none of), text, created / updated / due ranges, custom field values, and
`movedTo` — Jira's `status CHANGED TO X AFTER D`.

- Days are `2026-10-01` or relative to now, `-7d` and `+7d`, so a saved view keeps meaning "the last
  seven days".
- `movedTo` reads the audit trail: an event that set `stateId` to one of the states after the date,
  creation excluded — the trail is already the card's history (escopo-mvp 2.10), so nothing new is
  written to answer it.
- `POST /cards/search` runs a filter; it answers only with what the caller may open — the card gate's
  rule applied in SQL (guests see only their own cards). Every value is a bound parameter, one per
  element: the Data API takes no array parameters (ADR-0002).
- A **saved view** stores a filter, an order and a layout (board, list or backlog, lanes, columns).
  Personal views are their owner's; a space's views are for everyone who reads the space and are
  changed by their owner or a space admin. A view may span spaces; each reader still sees only what
  they may open.
- Text search (`GET /search`) is `ILIKE` over keys, titles, descriptions and comments. Semantic search
  over pgvector (escopo-mvp 3.11) is a separate feature and does not replace it.

## Consequences

- The panel edits a filter as chips and keeps it in the address (`?filtro=`), so a filtered board is a
  link. The MCP server will offer the same schema to an agent as a tool input — no parser to expose.
- There is no `OR` across conditions. None of the queries in use needs one; if one does, the filter
  grows an `any` list of sub-filters rather than a grammar.
- A Jira JQL is migrated by hand into a filter. The five in `fluxo-jira.md` are in the seed as the
  spaces' views and in `views.integration.test.ts`, each checked against matches it must find and
  decoys it must leave out.
- `ILIKE` with a leading wildcard scans the cards of the caller's spaces. That is fine at the volume of
  LET'S spaces; a trigram index is the next step when it is not.
