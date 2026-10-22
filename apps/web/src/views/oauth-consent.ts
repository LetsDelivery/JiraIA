import { type ConsentClient, oauthRead, oauthWrite } from '@/api/oauth'
import { read } from '@/api/requests'
import { consentRequest } from '@/lib/consent'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import type { View } from './view'

const refused = (reason: string): Html => html`
  <section class="consent">
    <h1>Não foi possível conectar</h1>
    <p class="muted">${reason}</p>
    <p class="muted">Feche esta aba e tente conectar de novo pelo aplicativo.</p>
  </section>
`

const card = (client: ConsentClient, email: string): Html => html`
  <section class="consent" data-consent>
    <span class="consent-mark" aria-hidden="true">${icon('robot', 24)}</span>
    <h1><strong>${client.name}</strong> quer acessar o JiraIA como você</h1>
    <p class="muted">Conectado como ${email}. Depois de permitir, você volta para <strong>${client.redirectHost}</strong>.</p>
    <ul class="consent-list">
      <li>${icon('eye', 16)}<span><strong>Ler</strong> espaços, cards e páginas que você lê.</span></li>
      <li>${icon('pencil', 16)}<span><strong>Criar e alterar</strong> cards, comentar e vincular, onde você pode escrever — com as suas permissões, nada além.</span></li>
      <li>${icon('history', 16)}<span>Tudo que ele fizer aparece no histórico como você, <strong>via ${client.name}</strong>.</span></li>
    </ul>
    <p class="muted consent-note">${client.connected ? 'Você já permitiu este aplicativo; permitir de novo só renova o acesso. ' : ''}Para desconectar depois, vá em Meu perfil → Aplicativos conectados.</p>
    <div class="row consent-actions">
      <button type="button" class="button button-ghost" data-consent-answer="deny">Cancelar</button>
      <button type="button" class="button button-primary" data-consent-answer="allow">Permitir</button>
    </div>
  </section>
`

/**
 * The consent page of the OAuth flow (ADR-0021, ADR-0022): an application asked to act as the person;
 * they see who it is, where it sends them back and that it writes as them, and allow or cancel.
 */
export const oauthConsentView: View = {
  path: '/oauth/autorizar',
  title: 'Conectar aplicativo',
  render: async () => {
    const parsed = consentRequest(new URLSearchParams(location.search))
    if (!parsed.ok) {
      return refused(parsed.reason)
    }
    const { clientId, redirectUri } = parsed.request
    const [client, me] = await Promise.all([
      oauthRead.consentClient(clientId, redirectUri).catch(() => undefined),
      read.me()
    ])
    return client
      ? card(client, me.email ?? me.name)
      : refused('Este aplicativo não está registrado, ou pediu para voltar a um endereço que não é dele.')
  },
  bind: (root) => {
    root.querySelector('[data-consent]')?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-consent-answer]')
      const parsed = consentRequest(new URLSearchParams(location.search))
      if (!button || !parsed.ok) {
        return
      }
      for (const each of root.querySelectorAll<HTMLButtonElement>('[data-consent-answer]')) {
        each.disabled = true
      }
      button.setAttribute('aria-busy', 'true')
      void oauthWrite
        .authorize({ ...parsed.request, allow: button.dataset.consentAnswer === 'allow' })
        .then(({ redirectTo }) => location.assign(redirectTo))
        .catch((refusal: unknown) => {
          toast(refusalSentence(refusal), 'error')
          button.removeAttribute('aria-busy')
          for (const each of root.querySelectorAll<HTMLButtonElement>('[data-consent-answer]')) {
            each.disabled = false
          }
        })
    })
  }
}
