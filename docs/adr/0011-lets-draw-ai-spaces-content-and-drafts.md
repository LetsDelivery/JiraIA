# 11. LET’S Draw AI has its own spaces, a tree of folders, pages and whiteboards, and drafts from a prompt

Date: 2026-10-16

## Status

Accepted. Amends ADR-0009 (pages belonged to JiraIA spaces; guests saw none) and ADR-0010 (LET’S Draw
AI listed JiraIA's spaces).

## Context

Stênio set LET’S Draw AI apart from JiraIA, as Confluence is from Jira: its spaces are created as a
team needs one, not mirrored from the boards. Its sidebar follows Confluence's: the space and its menu,
"Conteúdo" with create and filter, a search by title, the tree. And it holds more than pages: folders
and subfolders, blank pages, whiteboards — and, first among them, something made from a prompt.

## Decision

- **Draw spaces are their own table** (`draw_spaces`): a name, an icon (emoji), a description, who
  created it. **Open to the whole organization:** every active member reads and writes; whoever created
  it, or an organization admin, changes and deletes it. A star and a follow are each member's own, not
  audited (`draw_space_marks`). There are no space roles yet — if a team needs a closed space, roles
  come back as JiraIA's do (ADR-0004).
- **Content is one tree** (`contents`) with a `kind`: `folder`, `page` or `whiteboard`. A folder only
  holds; a page or a folder may hold; a whiteboard holds nothing. Pages and whiteboards are documents —
  Yjs, versions, comments, the realtime relay — exactly as ADR-0009 set for pages.
- **A whiteboard is drawn by the panel**, an SVG over the document's `shapes` map (notes, boxes,
  ellipses, text, frames, arrows, pen strokes). tldraw's licence is not permissive; Excalidraw needs
  React, and the panel has no framework (ADR-0006). The API knows a shape only to lay out a draft.
- **"Criar com IA"** is a chat: the whole conversation goes to `POST /draw/spaces/{id}/drafts`, which
  asks Claude (Opus 5.5, structured output, server-side fallbacks on) for a draft — Markdown for a
  page, sections and notes for a board — and turns it into the content's first document. Nothing is
  written until the person creates it, as content with a `draft`; the editor fills the live document
  from it the first time it opens. Effort is low: the HTTP API stops a request at 30 seconds.
- **Without a key** (local, and AWS until pendência #8 closes) the route answers 503 in AWS; the local
  harness hands in an offline writer that outlines the prompt and says, in its reply, that no model
  wrote it.

## Consequences

- JiraIA's spaces keep cards only; a card is still mentioned or embedded in a page by its key.
- The draft route is synchronous. If drafts grow beyond what fits in 30 seconds, they become a job the
  panel polls — the request and response shapes stay the same.
- Content that has stored JSON but no Yjs document is filled by whoever opens it first; two people
  opening it in the same instant would both fill it. It happens once per item (seeded, drafted, or
  imported from Confluence in Etapa 8).
