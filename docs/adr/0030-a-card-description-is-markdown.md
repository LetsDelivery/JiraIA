# 30. A card's description is Markdown, edited as rich text

Date: 2026-10-23

## Status

Accepted.

## Context

A card's description was a plain `<textarea>` over `cards.description` (`text`). People write specs in
documents and paste them into cards: headings, tables of rules, bullet lists, checklists. Pasted into
the textarea, all of it became flat lines. They asked for the formatting tools pages already have.

Pages keep their document as a Y.Doc edited together in real time (ADR-0009). A card is not edited by
several people at once: each field saves on its own, and the description has a Save button. The
description is also read outside the panel — by the MCP tools (ADR-0020), by agents writing proposals
(ADR-0019), and later by the Jira import, whose descriptions come as rich text.

## Decision

- **The description stays one `text` column, holding Markdown** (GitHub-flavoured: tables, task
  lists). No migration: a plain-text description is already Markdown, and the API and MCP tools carry
  it unchanged. Agents read and write Markdown without being taught a format.
- **The panel edits it as rich text**: TipTap with `@tiptap/markdown` (MIT), parsing the Markdown on
  open and serializing it on Save. Pasted HTML is parsed by TipTap, so a document's headings, tables
  and lists arrive with their shape.
- **The editor offers only what Markdown can carry**: headings, bold, italic, strike, code, links,
  bullet, numbered and task lists, quotes, code blocks, tables. No underline, colour, alignment or
  callout — the page bar's tools that would be lost on saving (`ToolKit` `'markdown'` in
  `editor/format-toolbar.ts`).
- **No real-time collaboration on the description.** The editor is local to the dialog; text typed and
  not saved survives a redraw of the card after another field is saved.
- **The editor is loaded on first use** (`import()`), so the board does not carry TipTap (escopo-mvp 8.1).

## Consequences

- Markdown tables have no block content: a pasted cell with several paragraphs or a list does not
  come back from Save as it was pasted.
- Where a description is shown as text (an MCP answer, a future e-mail), it reads as Markdown source.
  A surface that shows it to people renders it or strips it.
- The Jira import converts Jira's rich text to Markdown before writing the card.
