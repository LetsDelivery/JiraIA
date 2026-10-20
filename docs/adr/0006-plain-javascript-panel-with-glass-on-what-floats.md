# 6. The panel in plain JavaScript, with glass on what floats

Date: 2026-10-15

## Status

Accepted. Deviates from ADR-0001, which inherited uselets' React 19 + TanStack + Tailwind +
`@uselets/ui` panel.

## Context

The panel was first built the uselets way. Stênio decided the JiraIA panel does not need a framework:
its screens are few and plain, and a framework is weight the browser pays on every load. The trade-off
was raised and accepted knowingly: the coming stages bring a drag-and-drop board, a virtualised list
of 20,000 cards and a real-time editor, which a framework would have made easier, and `@uselets/ui`
— where the Max identity lives — exists only for React.

## Decision

The panel is plain TypeScript compiled to plain JavaScript, bundled by Vite. No UI framework.

- **Rendering:** each screen (`src/views/*`) renders markup from data with `html` tagged templates
  that **escape every interpolated value** (`src/lib/html.ts`); `raw` is reserved for the icons the
  app ships. A `bind` step attaches the screen's listeners after each render.
- **Routing:** the History API (`src/lib/router.ts`); links are ordinary `<a href>`.
- **Data:** `openapi-fetch` typed from the generated contract, behind a small cache invalidated by key
  prefix (`src/lib/cache.ts`, `src/api/requests.ts`). A write invalidates what it changed and the app
  re-renders what is on screen.
- **Design:** the `design-principles` skill. Warm, slightly brand-tinted neutrals; one accent, the
  Max red; Inter; 4px grid; radii 8/12; Tabler icons inlined as SVG. Controls are our own (a
  `combobox` + `listbox` select, not the native `<select>`), keyboard-operable.
- **Glass only on what floats:** sidebar, header, dialogs, select menus and toasts are translucent
  with a backdrop blur, over a faint brand light. Cards and tables — the content — stay solid with a
  1px border, for legibility and because blur over long lists is GPU work on every scroll. Menus and
  toasts use a denser glass so text behind them never bleeds through. Without `backdrop-filter`, or
  under `prefers-reduced-transparency`, glass falls back to a solid surface.

## Consequences

- The panel's JavaScript went from 128 KB to 12 KB gzipped.
- The Max look is now this repository's CSS (`src/styles/tokens.css`), not `@uselets/ui`; it will
  drift from uselets unless someone keeps them aligned.
- Drag-and-drop, list virtualisation and the editor integration (TipTap and Yjs both work without a
  framework) are ours to write in their stages. If one of them becomes the bottleneck, reintroducing a
  framework for that screen alone is the fallback, and it gets its own ADR.
