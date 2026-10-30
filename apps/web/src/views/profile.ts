import { oauthRead } from '@/api/oauth'
import { outwardRead, outwardWrite } from '@/api/outward'
import { type Me, read, write } from '@/api/requests'
import { html } from '@/lib/html'
import { bindConnections, connectionsSection } from '@/ui/connections'
import { openFormDialog, textField } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { bindTokenTable, openNewToken, tokenTable } from '@/ui/token-table'

import type { View } from './view'

/** The person changes their name and job title; the e-mail is their Google account's. */
const editProfile = (me: Me) =>
  openFormDialog({
    title: 'Editar perfil',
    submit: 'Salvar',
    done: 'Perfil atualizado.',
    fields: html`${textField({ name: 'name', label: 'Nome', required: true, maxLength: 120, value: me.name })}
      ${textField({ name: 'jobTitle', label: 'Cargo', placeholder: 'Ex.: Engenheira de software', maxLength: 80, value: me.jobTitle ?? '' })}
      <p class="field-hint">O e-mail vem da sua conta Google e não muda aqui.</p>`,
    onSubmit: (data) =>
      write.updateProfile({ name: String(data.get('name')), jobTitle: String(data.get('jobTitle')).trim() || null })
  })

/**
 * A person's own page: who they are here, their API tokens (escopo-mvp 4.8) — each acts as them,
 * with exactly their access, on the `/v1` routes — and the applications they connected (ADR-0021).
 */
export const profileView: View = {
  path: '/perfil',
  title: 'Meu perfil',
  render: async () => {
    const [me, tokens, connections] = await Promise.all([read.me(), outwardRead.myTokens(), oauthRead.connections()])
    return html`
      <header class="page-header row">
        <div>
          <h1>${me.name}</h1>
          <p class="muted">${me.jobTitle ? html`${me.jobTitle} · ` : ''}${me.email ?? ''}</p>
        </div>
        ${me.kind === 'person' ? html`<button type="button" class="button button-secondary" data-edit-profile>${icon('pencil', 16)}Editar perfil</button>` : ''}
      </header>
      <section class="section">
        <div class="section-head">
          <div>
            <h2>Tokens para scripts</h2>
            <p class="muted">Para scripts agirem como você na API, com o mesmo acesso que você tem. Para um assistente como o Claude, não precisa de token: veja <a class="link" href="/integracoes">Integrações</a>.</p>
          </div>
          <button type="button" class="button button-primary" data-new-token>${icon('plus', 16)}Novo token</button>
        </div>
        ${tokenTable(tokens.items, 'Você ainda não criou nenhum token.')}
      </section>
      ${connectionsSection(connections.items)}
    `
  },
  bind: (root) => {
    root.querySelector('[data-edit-profile]')?.addEventListener('click', () => void read.me().then(editProfile))
    root
      .querySelector('[data-new-token]')
      ?.addEventListener('click', () => openNewToken('Novo token para scripts', outwardWrite.createToken))
    bindTokenTable(root)
    bindConnections(root)
  }
}
