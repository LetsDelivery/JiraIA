# 10. Two products, one panel: JiraIA for cards, LET’S Draw AI for pages

Date: 2026-10-16

## Status

Accepted. Amended by ADR-0011: LET’S Draw AI has its own spaces, addressed by id.

## Context

Etapa 4 first put the pages in a tab of each JiraIA space, next to the board. Stênio asked for them
to stand apart, as Confluence stands apart from Jira: their own product, called **LET’S Draw AI**,
reached from JiraIA's sidebar the way Jira reaches its other apps — a tile, a name and an arrow that
says it opens elsewhere.

## Decision

- **One panel, two frames.** LET’S Draw AI lives under `/draw` in the same panel and the same
  deployment. Each screen declares its product (`View.area`); the app draws it in that product's
  frame — brand, navigation, page title — over the same shared shell, footer and search.
- **Addresses:** `/draw` (latest changed pages of every space the caller reads), `/draw/{KEY}` (a
  space's page tree), `/draw/{KEY}/{pageId}` (a page). A space is the same space in both products, by
  the same key and with the same roles.
- **The way between them** is a sidebar link to the other product that opens in a new tab: "LET’S
  Draw AI" in JiraIA, "JiraIA" in LET’S Draw AI. JiraIA's spaces no longer have a pages tab.
- Cards stay JiraIA's: a card mentioned or embedded in a page opens on its JiraIA board.
- The API is unchanged in shape: pages remain a module of `work` (ADR-0009); `GET /pages` lists the
  latest changed for the home.

## Consequences

- No second login, deployment or domain: the session, the cache and the search are shared.
- If LET’S Draw AI later needs its own domain, it is a second build of the same panel with `/draw` as
  its root — the routes already sit under one prefix.
- The search box searches both cards and pages from either product; its results open each in its own
  product.
