# 41. An opened card reads in one request and draws what a write answers

Date: 2026-10-31

## Status

Accepted. Changes how the panel reads a card (ADR-0027 still holds: the board's copy has no
description) and adds `GET /cards/{cardId}/detail`.

## Context

Opening a card sent thirteen requests at once — the card, its comments, history, relations,
attachments, watchers, worklogs, star, proposals, development, and three of the organization's — and
drew nothing until the slowest answered. In production each is its own Lambda invocation, each
authenticates and resolves roles again, and each query is an HTTP call to the Data API (ADR-0002),
against a database that may be resuming (ADR-0035). Meanwhile the dialog was open and empty.

Every write then drew the card by reading it all again — the same thirteen requests — although the
write had already answered with what changed. "Comentar" stopped spinning when the comment was
saved, then nothing moved until the reload ended: the click looked ignored.

## Decision

- **One request for the opened card.** `GET /cards/{cardId}/detail` answers the card and everything
  under it. Each part is read by the service that owns it, with its own permission check, so the
  answer never shows more than the separate routes; the card is read first and alone answers 404
  or 403. The separate routes stay, for the MCP and for anyone else.
- **The card shows at once.** The dialog opens with what the board already has — its path and
  title — and grey shapes where the rest goes, until the answer arrives.
- **Resting on a card starts reading it.** 120 ms of the pointer on a card, or the keyboard's focus,
  begins the request; the click takes it if it is under 15 s old. Each read begun ahead is used once,
  and any write that invalidates the cache drops them all, so a card moved on the board is read again.
- **A write draws what it answered, then reads again quietly.** A comment, an edit, a field: the
  answer is drawn straight away, then the page is read again for what the write changed elsewhere
  (history, followers). A reload that started before a later draw is dropped. Following and starring
  touch nothing else, and only draw their answer.
- **What a person does shows before the API answers.** The comment appears under the composer,
  faint, and the composer empties; following, starring and an existing reaction turn at the click.
  A refusal undoes the guess and says why.
- **A redraw keeps the reader's place**: each column's scroll, the comment being written, and the
  field being typed in, with its cursor.

## Consequences

- Opening a card costs one invocation instead of ten (the organization's three reads are cached).
- The detail answer carries every comment and the whole history: a card with thousands of events
  would need paging here, as it would have before.
- The same pattern — answer at the click, draw the write's answer, reload quietly — is the default
  for any other screen whose writes still read the whole screen again.
