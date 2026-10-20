# 17. The whiteboard is a scene of independent elements, drawn as rough SVG

Date: 2026-10-17

## Status

Accepted. Replaces the whiteboard part of ADR-0011 (its `shapes` map). Keeps ADR-0009 (Yjs documents,
versions, the realtime relay) and ADR-0006 (no framework in the panel).

## Context

The first whiteboard (ADR-0011) had notes, boxes, ellipses, text, frames, arrows and pen strokes, one
colour each, one at a time. Stênio asked for a diagramming tool on par with the ones the teams use:
diamonds, lines and arrows of several kinds tied to shapes, text inside shapes and on arrows, a style
panel, multiple selection, rotation, layers, groups, alignment, frames, snap, export and import.

tldraw's licence is not permissive and Excalidraw needs React, so the board stays ours.

## Decision

- **Every element is an independent object**, one entry of the document's `elements` map, keyed by
  its id. Two people editing two elements never write the same entry. An element has a type
  (`rectangle`, `ellipse`, `diamond`, `line`, `arrow`, `text`, `freedraw`, `image`, `frame`), a box
  (`x`, `y`, `width`, `height`) turned by `angle` around its centre, a style, a drawing order `z`
  (a number, as cards' `rank`), and links: `groupIds`, `frameId`, `boundElements`, and for a text its
  `containerId`, for an arrow its `startBinding` and `endBinding`. The `board` map holds what is the
  whole board's: its background colour.
- **What another client wrote is data.** Every element read from the document goes through one
  `clean` step: colours must be hex or `transparent`, numbers finite and in range, links `http(s)`,
  types and enums from their lists. The SVG is built only from cleaned values.
- **Drawn as SVG by hand, with rough.js** (MIT) for outlines and fills: roughness 0, 1 and 2 are the
  architect, artist and cartoonist styles; the four fills are rough.js's. Each element has a `seed`,
  so its wobble is the same on every screen. Each element is drawn in its own coordinates and placed
  with one transform; the drawing is cached by what the element looks like.
- **Text is SVG `<text>`**, broken into lines by measuring words on a canvas, so it turns with its
  element and exports as drawn. A text inside a shape or on an arrow is placed from its container every
  time it is read, so it always follows the shape. The handwritten face is Caveat (OFL-1.1).
- **Undo is per person**: a `Y.UndoManager` tracks only this person's writes. A drag merges into one
  step; a delete, a duplicate or a style is a step of its own.
- **Dark theme** inverts the scene as a whole (and images back), so an element keeps one set of
  colours and reads well in both themes.
- **Older boards** keep working: their `shapes` are converted to elements on read, and written as
  elements by the first person who can edit the board. A board drafted by the API (ADR-0011) is now
  laid out as elements.

## Consequences

- The board is drawn again whole on each change (at most once per frame). With the drawing cache this
  holds for hundreds of elements; a board of thousands would need drawing only what changed.
- A concurrent edit of one element by two people keeps the last write of the whole element.
- **Saving, adapted to a board that saves on every change** (Stênio, 2026-10-17): the browser keeps a
  copy of each whiteboard it opens in IndexedDB (`y-indexeddb`, MIT), merged by Yjs both ways, so a
  dropped connection loses nothing; "save" is a named version; files are `.json` (ours) and
  `.excalidraw` in, PNG, SVG and `.json` out; "recent" is what each person opened, kept on the server.
- **The browser copy is content on the employee's machine.** It is the same content the person can open
  anyway, it stays in that browser's storage, and signing out does not clear it. Clearing it on sign-out
  is later work if the security review asks for it.
- Images live in the content's files (storage), never inside the document: the element keeps the file's
  id, and the address to read it is asked for when the board is drawn.
