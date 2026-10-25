# 34. A wiki collection may be restricted or personal; whoever cannot read it never learns it exists

Date: 2026-10-25

## Status

Proposed. Spec: `docs/produto/wiki-navegacao.md`. Amends ADR-0012 for wiki collections only, as its
Consequences foresaw ("a per-space switch that removes the reader floor"). Builds on ADR-0033.

## Context

Everyone at LET’S reads every space (ADR-0012). The wiki is to hold commercial knowledge too —
prices discussed, legal positions, people matters — which part of LET’S must not read, and each person
needs somewhere to draft before anything is shared. Stênio decided (2026-10-25) that collections may
be private or shared, alongside the fuller navigation.

## Decision

- **`wiki_collections.access`**: `organization` (default — every active member reads, as today),
  `restricted` (only those holding a role, directly or through a group) or `personal`.
- **The reader floor depends on the space.** `AccessResolver.forSpace` adds the organization reader
  only when the space is not a restricted or personal wiki collection. Draw spaces and JiraIA spaces
  are unchanged. Roles, groups, requests and "why does this person have access" work as they do.
- **A role of `reader`** is now meaningful for restricted collections and is grantable there.
- **A personal collection** belongs to one member (`wiki_collections.owner_id`, unique), is created on
  first use by `GET /wiki/me/collection`, and makes its member admin. Its pages cannot be made official;
  "publish to a collection" copies one as a draft, as from Draw (W8).
- **Not readable is not found.** Every listing filters by what the caller reads — collections, trees,
  recent, favorites, search, reviews, Monday's summary, mentions — and a direct address answers 404,
  so a restricted collection's name never leaks.
- **Favorites** are each member's own (`wiki_favorites`), not audited, like a star on a card. Pages
  only; a page that becomes unreadable drops out of the list without being deleted.
- **A page's icon** is an optional emoji on the content (`contents.icon`), shared with Draw.
- Changing a collection's access, and every grant in a restricted collection, is audited.

## Consequences

- Listings that used to read "every space of the organization" now need the caller's readable set:
  one query of the collections where the member holds a role or the access is `organization`, reused
  by the wiki's listings and search.
- A collection made restricted keeps its existing grants; people with no role lose reading at once.
- Agents and MCP read through the same gate, so they see only what their person sees (ADR-0022).
- Draw stays open to all; closing a Draw space is still out of scope.
