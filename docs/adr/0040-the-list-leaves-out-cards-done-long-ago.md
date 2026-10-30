# 40. The Lista leaves out the cards done long ago

Date: 2026-10-30

## Status

Accepted. Narrows escopo-mvp 3.2 (the Lista) by default; ADR-0008's filter gains one condition.

## Context

The Lista draws every card of a space as a table row. TEC, after the migration from Jira, holds 3,244
cards, 2,824 of them done: about 40 thousand elements on screen, ~530 ms to draw on a desktop and
~1.4 s on a slower phone — and the panel draws the whole screen again after every change. Almost all
of those rows are work finished months ago, which nobody reads in the Lista.

## Decision

- **By default the Lista leaves out a done card that entered a done state more than 60 days ago.**
  Nothing is archived nor changed: the card is still found by search, by its key, by a filter or a
  saved view, and on the Board and the Backlog, which this does not touch.
- **The date is when the card entered a done state**, read from its history (the audit trail, which
  holds the history imported from Jira, ADR-0036) — not its last update, which a late comment moves.
  A card created already done counts from its creation, since its `created` event names no state.
- **The Lista says so above the table** — "2284 concluídos há mais de 60 dias ocultos · Mostrar
  todos". `?concluidos=todos` shows every card; leaving the tab goes back to the default.
- **A filter that names states is left alone**: whoever filters by state, or by "moved to", asks
  for exactly those cards.
- **It is a condition like the others, `doneSince` (`-60d`)**, on the structured filter and on
  `GET /spaces/{spaceId}/cards`. The Lista without a filter reads through the latter, page by page
  and without descriptions, so it is not cut by the search's limit of 500.

## Consequences

- TEC's Lista draws 960 rows instead of 3,244: ~265 ms on a desktop, ~0.5 s on a slower phone.
- With a filter on, the Lista still reads through the search, whose answer stops at 500 cards
  without saying so; a space as large as TEC can reach it. That limit predates this decision.
