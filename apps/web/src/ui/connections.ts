import { type Connection, oauthWrite } from '@/api/oauth'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { busy } from '@/ui/busy'
import { icon } from './icons'
import { toast } from './toast'

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/**
 * Meu perfil → Aplicativos conectados (ADR-0021): each application the person allowed to act for them
 * by OAuth, and the button that ends it at once.
 */
export const connectionsSection = (items: readonly Connection[]): Html => html`
  <section class="section">
    <div class="section-head">
      <div>
        <h2>Aplicativos conectados</h2>
        <p class="muted">Aplicativos que você permitiu ler e escrever no JiraIA como você, pelo MCP. O que eles fazem aparece no histórico como seu, “via” o aplicativo.</p>
      </div>
    </div>
    ${
      items.length
        ? html`<table class="table">
            <thead><tr><th>Aplicativo</th><th>Volta para</th><th>Conectado em</th><th>Último uso</th><th></th></tr></thead>
            <tbody>${items.map(
              (item) => html`<tr data-connection="${item.id}">
                <td>${icon('robot', 16)} ${item.application.name}</td>
                <td class="data">${item.application.redirectHost}</td>
                <td>${WHEN.format(new Date(item.createdAt))}</td>
                <td>${item.lastUsedAt ? WHEN.format(new Date(item.lastUsedAt)) : 'Nunca'}</td>
                <td><button type="button" class="button button-ghost button-small" data-disconnect>Desconectar</button></td>
              </tr>`
            )}</tbody>
          </table>`
        : html`<div class="empty"><p class="empty-title">Nenhum aplicativo conectado</p><p class="muted">Quando você conectar o JiraIA a um assistente pelo MCP, ele aparece aqui.</p></div>`
    }
  </section>
`

export const bindConnections = (root: HTMLElement): void => {
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-disconnect]')
    const id = button?.closest<HTMLElement>('[data-connection]')?.dataset.connection
    if (!button || !id) {
      return
    }
    void busy(button, () => oauthWrite.revoke(id))
      .then(() => toast('Aplicativo desconectado.'))
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  })
}
