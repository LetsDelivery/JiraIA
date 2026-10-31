# 42. Attachments preview in the panel, drawn by the browser

Date: 2026-10-31

## Status

Accepted. Adds `previewUrl` to an attachment and `pdfjs-dist` to the panel.

## Context

A click on an attachment always downloaded it: the only URL the API handed out was signed with
`Content-Disposition: attachment`. To read a PDF or a screenshot someone attached, a person saved
it, found it and opened it outside JiraIA. The tiles showed a picture only for images; a PDF, a
Markdown file or a video was the same grey icon as a spreadsheet.

## Decision

- **A second URL shows the file instead of saving it.** Each attachment carries `previewUrl`,
  signed `inline`, as short-lived as `url` (five minutes). `FileStore.downloadUrl` takes
  `inline`; S3, the local harness and the in-memory store honour it.
- **The browser draws the file; nothing leaves for a third party.** Clicking a tile opens a viewer
  over the page: images, PDFs (the browser's own reader), video and audio in place; text — by type,
  or by extension when the browser sent none — as lines with numbers, its markup kept as characters.
  Office files and archives offer the download. Sending a signed URL to an online Office viewer
  would hand the file to that company, so we do not.
- **The tile shows the file before it is opened.** An image is itself; a video, its first frame;
  a text, its first lines; a PDF, its first page.
- **The first page of a PDF is drawn by pdf.js** (`pdfjs-dist`, Apache-2.0, Mozilla), wrapped in
  `apps/web/src/lib/pdf-page.ts`. It is loaded with `import()` only when a card has a PDF — about
  130 kB gzipped plus a 1.2 MB worker, outside the panel's main bundle. It fetches the file in one
  plain GET (`disableRange`): the bucket's CORS rule lets no `Range` header through.
- **A tile is drawn once per tab.** A file never changes under its id, so the picture is kept by id
  while the tab lives; the card's frequent redraws reuse it, and a render under way is shared.
  PDFs over 20 MB and texts over 512 kB keep the icon, rather than download the whole file for a
  tile.

## Consequences

- Reading an attachment no longer means downloading it; downloading is the tile's own button.
- Opening a card with PDFs downloads each of them in full once per tab, to draw its first page.
- pdf.js is a large dependency to keep current; it is the only one in the panel that parses files
  people upload, so its security releases are taken promptly.
- A file type the browser cannot draw still downloads. A server-side converter (Office to PDF)
  would be its own decision.
