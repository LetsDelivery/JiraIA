# 43. A comment is Markdown and shows the files it cites

Date: 2026-10-31

## Status

Accepted. Changes how the panel writes and draws a card's comment. The API's `body` stays a string
of up to 20,000 characters; mentions stay `<@memberId>`. Builds on ADR-0042 (attachments preview).

## Context

A comment was plain text from a `<textarea>`: no bold, no list, no link. Comments imported from Jira
were already Markdown (`adf-markdown.ts`) and showed their `**` and `#` as characters. Where Jira had
a picture, the import wrote `📎 name`. The file itself was copied to JiraIA as one of the card's
attachments (`jira-attachments.ts`), but the comment showed only its name.

People also attach a file while writing a comment. Before, a pasted image went to the card's
attachments and left nothing in the comment. A file dropped on the comment was taken by the card's
drop zone and did the same.

## Decision

- **A comment is Markdown, written with the description's editor.** It uses the same tools and the
  same bar. The bar shows only once a person starts a comment; until then the composer is one line.
  A mention is a node kept as `<@memberId>` in the Markdown, so notifications, e-mails and the MCP
  read it as before. A single line break stays a line break (`breaks: true`), so a comment written
  as plain text reads as it did.
- **A saved comment is drawn through the editor's schema.** It does not go through a Markdown-to-HTML
  library. Only what the editor knows survives: no script, no style, no `javascript:` link, and every
  text is escaped by ProseMirror.
- **A comment cites a file as `📎 name`.** This is the form the import already writes. A file
  pasted, dropped on the comment or chosen with its Anexar button goes to the card's attachments.
  The comment cites it on its own line, and the editor shows it as the picture it will be.
- **The file is the card's attachment of that name.** It comes from the card's own attachments, the
  rows the Anexos panel lists, in JiraIA's database and bucket. Nothing is fetched from Jira, from the
  import's raw copy or from a backup.
  - Of several files with one name, the one sent nearest the comment's time is shown.
  - A name the card no longer has stays as text.
  - Alone on its line, a citation shows the picture; inside a sentence it is a chip.
  - Both open the viewer.
- **A pasted file is named so its citation finds it alone.** It keeps its own name unless that is
  the clipboard's usual `image.png` or the card already has the name. Then it gets the moment it was
  pasted, as Jira does: `image-20261031-174210.png`, then `-2`.

## Consequences

- Imported comments read as they did in Jira, with their pictures.
- A comment written as plain text before can read differently where it holds Markdown characters
  (a lone `*`, `_` or `#` at the start of a line).
- A citation is a name, not an id. Renaming an attachment, if that is ever allowed, would leave
  its citations as text. Deleting one does the same, on purpose.
- The comment and the description share one editor's code, so a tool added to one is offered to
  the other.
