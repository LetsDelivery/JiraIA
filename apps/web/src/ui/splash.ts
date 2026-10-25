import { DRAW_HOME } from '@/lib/draw'
import { html } from '@/lib/html'

/** Whether a path belongs to LET’S Draw AI, which opens in a tab of its own (ADR-0010). */
const isDraw = (path: string): boolean => path === DRAW_HOME || path.startsWith(`${DRAW_HOME}/`)

/**
 * What a tab shows before its first screen: the product's brand, centred, over a spinner — right
 * after signing in, and when a signed-in tab comes back and the API is read again.
 */
export const splash = (path: string) => {
  const brand = isDraw(path) ? html`LET’S Draw <span>AI</span>` : html`Jira<span>IA</span>`
  return html`
    <div class="splash" role="status" aria-busy="true">
      <p class="splash-brand">${brand}</p>
      <span class="splash-spinner" aria-hidden="true"></span>
      <span class="sr-only">Carregando…</span>
    </div>
  `
}
