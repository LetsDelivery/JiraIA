# 23. The panel is mobile first

Date: 2026-10-19

## Status

Accepted. Extends ADR-0006 (plain JavaScript panel, glass on what floats).

## Context

Stênio asked for the whole front to be designed mobile first and to work on phones, tablets and the
web. On a 390px phone the sidebar took 60% of the width and every screen was crushed beside it.

## Decision

- **Breakpoints:** phone up to 760px, tablet up to 1100px, desktop above. The frame is written mobile
  first in `components.css` — the phone's layout is the base, `min-width` queries add the rest.
- **Frame on a phone:** the sidebar is a drawer the menu button slides over the page (closed by a
  navigation, a tap outside or Escape); the search is an icon that opens over the header; "Criar" is an
  icon. From 761px the sidebar sits beside the page and may fold to its icons; from 1101px the search
  is centred and wide.
- **Screens:** `responsive.css` holds what screens need below desktop — headers and toolbars wrap,
  tabs scroll sideways on one line, tables scroll inside their frame up to a tablet, dialogs and the
  card's detail take the phone's width (the detail its whole screen), the board shows one column at a
  time with the next peeking in, touch targets are at least 40px. Screen-specific rules stay with the
  screen's stylesheet (the whiteboard's in `whiteboard.css`).
- **The rule a test keeps:** no screen scrolls the page sideways, on a phone or a tablet
  (`playwright/e2e/mobile.spec.ts`). A wide thing scrolls inside its own frame.

## Consequences

- A new screen is checked at 390px and 820px before it is done.
- Dragging cards on the board uses HTML drag and drop, which touch screens do not fire: on a phone,
  cards move through the card's state. A touch drag is later work.
