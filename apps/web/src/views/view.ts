import type { Html } from '@/lib/html'
import type { Params } from '@/lib/router'

/**
 * One screen: markup from data, then the listeners its markup needs.
 *
 * `render` runs again whenever cached data changes, so it holds no state of its own; `bind` runs after
 * each render, because the markup it listens on was just replaced.
 */
export type View = {
  path: string
  title: string
  /** The product the screen belongs to — JiraIA's cards or LET’S Draw AI's pages (ADR-0010). */
  area?: 'jiraia' | 'draw'
  /** Runs once when the screen is navigated to — not on the re-renders that follow. */
  enter?: (params: Params) => Promise<void>
  render: (params: Params) => Promise<Html>
  bind?: (root: HTMLElement, params: Params) => void
  /** Runs when the screen is left for another — or for the same one with other params. */
  leave?: () => void
  /** LET’S Draw AI's screens draw their own sidebar — a space's tree, or the list of spaces. */
  sidebar?: (params: Params) => Promise<Html>
  bindSidebar?: (sidebar: HTMLElement, params: Params) => void
}
