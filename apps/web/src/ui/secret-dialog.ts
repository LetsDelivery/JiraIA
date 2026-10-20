import { html } from '@/lib/html'

import { openNotice } from './dialog'
import { icon } from './icons'
import { toast } from './toast'

/**
 * A secret shown the one time it exists in the clear — an API token, a webhook's signing key. After
 * this dialog closes, nobody can read it again; only a new one can be made.
 */
export const showSecretOnce = (title: string, secret: string, hint: string): void => {
  openNotice(
    title,
    html`
      <p class="muted">${hint}</p>
      <div class="secret-box">
        <code class="secret-value" data-secret>${secret}</code>
        <button type="button" class="button button-secondary button-small" data-copy-secret>${icon('link', 16)}Copiar</button>
      </div>
      <p class="secret-warning">${icon('lock', 16)}Guarde agora: este valor não será mostrado de novo.</p>
    `
  )
  document.querySelector('[data-copy-secret]')?.addEventListener('click', () => {
    void navigator.clipboard.writeText(secret).then(() => toast('Copiado.'))
  })
}
