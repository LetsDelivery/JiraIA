import { type SkeletonKind, skeleton } from './skeleton'

/** A screen that answers within this shows no skeleton at all. */
export const SHOW_AFTER_MS = 150
/** A skeleton once shown stays at least this long, so it never flashes. */
export const SHOW_FOR_MS = 300

export type Placeholder = { settle: () => Promise<void> }

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Holds a screen's place while it loads. Nothing changes for a quick answer; after `SHOW_AFTER_MS`
 * the screen's skeleton replaces the old one, and `settle` keeps it up for `SHOW_FOR_MS` before the
 * real screen goes in. `wanted` drops a render another navigation has overtaken.
 */
export const holdPlace = (
  host: HTMLElement | null,
  kind: SkeletonKind | undefined,
  wanted: () => boolean
): Placeholder => {
  let shownAt: number | undefined
  const timer = setTimeout(() => {
    if (host?.isConnected && wanted()) {
      host.innerHTML = skeleton(kind).value
      host.setAttribute('aria-busy', 'true')
      shownAt = performance.now()
    }
  }, SHOW_AFTER_MS)
  return {
    settle: async () => {
      clearTimeout(timer)
      const left = shownAt === undefined ? 0 : SHOW_FOR_MS - (performance.now() - shownAt)
      if (left > 0) {
        await wait(left)
      }
    }
  }
}

/** The menu item just clicked is marked at once, before its screen has loaded. */
export const markCurrent = (sidebar: HTMLElement | null, path: string): void => {
  for (const link of sidebar?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []) {
    const current = link.getAttribute('href') === path
    if (current) {
      link.setAttribute('aria-current', 'page')
    } else {
      link.removeAttribute('aria-current')
    }
    const item = link.closest('.page-tree-row') ?? link
    if (item.matches('.nav-item, .nav-sub-item, .page-tree-row')) {
      item.classList.toggle('is-active', current)
    }
  }
}
