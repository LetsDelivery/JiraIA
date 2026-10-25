import { DRAW_HOME } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { WIKI_HOME } from '@/lib/wiki'

export type Product = 'jiraia' | 'draw' | 'wiki'

/** Whether a path is under a product's root: the root itself, or anything below it. */
const under = (root: string, path: string): boolean => path === root || path.startsWith(`${root}/`)

/** The product a path belongs to: LET’S Draw AI and LET’S Wiki each open in a tab of their own (ADR-0010, ADR-0033). */
export const productOf = (path: string): Product => {
  if (under(DRAW_HOME, path)) {
    return 'draw'
  }
  return under(WIKI_HOME, path) ? 'wiki' : 'jiraia'
}

const BRAND: Record<Product, Html> = {
  jiraia: html`Jira<span>IA</span>`,
  draw: html`LET’S Draw <span>AI</span>`,
  wiki: html`LET’S <span>Wiki</span>`
}

/** The product's name, for the tab's title while its first screen loads. */
export const PRODUCT_NAME: Record<Product, string> = { jiraia: 'JiraIA', draw: 'LET’S Draw AI', wiki: 'LET’S Wiki' }

/**
 * What a tab shows before its first screen: the product's brand, centred, over a spinner — right
 * after signing in, and when a signed-in tab comes back and the API is read again.
 */
export const splash = (path: string) => html`
  <div class="splash" role="status" aria-busy="true">
    <p class="splash-brand">${BRAND[productOf(path)]}</p>
    <span class="splash-spinner" aria-hidden="true"></span>
    <span class="sr-only">Carregando…</span>
  </div>
`
