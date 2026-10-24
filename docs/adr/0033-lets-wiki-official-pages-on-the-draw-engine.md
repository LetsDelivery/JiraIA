# 33. LET’S Wiki: official pages with an owner and a review date, on the Draw engine

Date: 2026-10-24

## Status

Proposed. Spec: `docs/produto/wiki.md`. Extends ADR-0010 (a third product in the panel) and
ADR-0011 (its content is Draw's).

## Context

LET’S wants one place that holds what is true about the company and its customers. LET’S Draw AI
stores and edits pages, but it is a place to draft: every member writes everywhere, and an official
policy and someone's notes on the same subject look alike. A page that is never reviewed goes stale
without anyone noticing.

What is missing is trust, not storage: who answers for a page, whether it is official, and until when
it holds.

## Decision

- **A third area of the panel**, `/wiki`, named LET’S Wiki, with its own frame (`area: 'wiki'`) over
  the shared shell, search and session. JiraIA and Draw link to it from their sidebars.
- **Collections and their pages are created in the wiki**, on the wiki's own screens; nobody goes
  through Draw. Underneath, both products stand on one content engine — the tree, Yjs documents,
  versions, comments, the realtime relay and search — which Draw happened to build first. Its table,
  `draw_spaces`, gains an `area` (`draw` or `wiki`) saying which product a space belongs to; a
  collection's review period and page outline sit beside it in `wiki_collections`. Each product lists,
  creates and opens only its own; neither shows the other's. Renaming `draw_spaces` and its role tables
  to neutral names is a mechanical change of its own, left out of this one to keep it reviewable.
  This is reuse of code, not a dependency of the wiki on Draw: a second editor, versions and realtime
  relay would cost weeks and be maintained twice.
- Collections are created by organization admins; their space admins are the collection's owners, and
  its members are its editors. Everyone reads, as in every space (ADR-0012).
- **A wiki page carries an owner, a state and a review date** in its own table (`wiki_pages`, keyed by
  `content_id`): `owner_id`, `state` (`draft` or `official`), `reviewed_at`, `review_due`. A
  collection carries its review period (`review_days`, 90 by default). Owners make a page official;
  its owner or an owner confirms a review, which moves `review_due` on. A page past `review_due` stays
  official and says so.
- **Notice is the weekly summary** (ADR-0028): each owner gets the pages due within 14 days or past
  due. No new job.
- **Customer knowledge is a collection with a fixed page outline**, shipped by the app. Contracts and
  prices stay in Google Drive and are linked; personal data is not written in the wiki.
- **"Publicar na Wiki"** is a shortcut for whoever drafted in Draw: it copies a Draw page into a
  collection as a draft, keeping a link back; the Draw page stays where it was. Most wiki pages are
  written in the wiki.
- Every change of state, owner, review or collection owner is audited in the same transaction.

## Consequences

- Little new machinery: one column, two tables, four screens and a sidebar link; the editor and the
  realtime relay are untouched.
- Collections share Draw's access model, so a closed collection (Finance, Legal, People) is not
  possible yet; it needs space roles that can deny reading, which ADR-0012 rules out today.
- A page moved between a collection and a Draw space would change product; moving across areas is
  refused.
- A wiki page's text, versions, comments and files go through the content routes under
  `/draw/contents/{id}`, gated by the same space roles; `/wiki/...` adds only what is the wiki's.
- Search returns each page's `area`, so the panel opens it in its own product.
- Answers from Laís citing official pages build on `wiki_pages.state` later, with no change to it.
